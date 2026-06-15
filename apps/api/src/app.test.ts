import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createSessionId, sessionCookieName, signSessionId } from './auth/cookies.js';
import { FileAuthStore } from './auth/store.js';
import { loadConfig } from './config.js';
import type { AtprotoIdentityService } from './identity/service.js';
import { RoomIndexStore } from './rooms/store.js';

const indexedRoomInput = {
  uri: 'at://did:plc:creator/app.pulse.room/room1' as const,
  cid: 'bafyroom',
  repo: 'did:plc:creator' as const,
  rkey: 'room1',
  record: {
    name: 'Repair Cafe',
    description: 'Weekly hardware debugging',
    createdAt: '2026-06-15T00:00:00.000Z',
    visibility: 'public' as const,
    joinMode: 'open' as const,
    server: {
      serviceDid: 'did:plc:pulseserver' as const,
      baseUrl: 'https://pulse.example.com' as const,
      createdAt: '2026-06-15T00:00:00.000Z',
    },
  },
};

const identityService = {
  getPrincipals: async () =>
    new Map([
      [
        'did:plc:creator',
        {
          did: 'did:plc:creator',
          handle: 'creator.example',
          displayName: 'Creator',
          pdsEndpoint: 'https://pds.example.com',
        },
      ],
      ['did:plc:pulseserver', { did: 'did:plc:pulseserver' }],
    ]),
} as unknown as AtprotoIdentityService;

const createTestAuth = async (did: string) => {
  const config = loadConfig({});
  const authStore = new FileAuthStore(
    join(await mkdtemp(join(tmpdir(), 'pulse-auth-')), 'auth.json'),
  );
  const sessionId = createSessionId();

  await authStore.setWebSession(sessionId, {
    did,
    handle: `${did.slice(did.lastIndexOf(':') + 1)}.example`,
    pdsEndpoint: 'https://pds.example.com',
    scope: config.oauthScope,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  });

  return {
    authStore,
    cookie: `${sessionCookieName}=${signSessionId(sessionId, config.sessionSecret)}`,
  };
};

describe('api app', () => {
  it('returns health information', async () => {
    const app = createApp(loadConfig({}));

    const response = await app.request('/healthz');

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'pulse-api',
      version: '0.1.0',
    });
  });

  it('returns client-safe app info', async () => {
    const app = createApp(loadConfig({}));

    const response = await app.request('/api/info');

    await expect(response.json()).resolves.toEqual({
      name: 'Pulse',
      version: '0.1.0',
      identity: 'atproto',
      media: 'webrtc',
    });
  });

  it('returns an anonymous auth session without a cookie', async () => {
    const app = createApp(loadConfig({}));

    const response = await app.request('/api/auth/session');

    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });
  });

  it('rejects missing handles before starting OAuth discovery', async () => {
    const app = createApp(loadConfig({}));

    const response = await app.request('/api/auth/atproto/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: '' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Enter a valid AT Protocol handle.',
    });
  });

  it('resolves handles through the client-safe identity API', async () => {
    const identityService = {
      resolveHandle: async (handle: string) =>
        handle === 'alice.example'
          ? {
              did: 'did:plc:alice',
              handle,
              displayName: 'Alice',
              pdsEndpoint: 'https://pds.example.com',
            }
          : null,
    } as unknown as AtprotoIdentityService;
    const app = createApp(loadConfig({}), { identityService });

    const response = await app.request('/api/identity/resolve?handle=alice.example');

    await expect(response.json()).resolves.toEqual({
      identity: {
        did: 'did:plc:alice',
        handle: 'alice.example',
        displayName: 'Alice',
        pdsEndpoint: 'https://pds.example.com',
      },
    });
  });

  it('serves OAuth client metadata for local development', async () => {
    const app = createApp(loadConfig({ PULSE_PUBLIC_URL: 'http://127.0.0.1:8787' }));

    const response = await app.request('/oauth-client-metadata.json');
    const payload = await response.json();
    const clientId = new URL(payload.client_id);

    expect(payload).toMatchObject({
      scope:
        'atproto repo:app.pulse.room repo:app.pulse.room.server repo:app.pulse.room.member repo:app.pulse.room.presence',
    });
    expect(clientId.origin).toBe('http://localhost');
    expect(clientId.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:8787/api/auth/atproto/callback',
    );
    expect(clientId.searchParams.get('scope')).toBe(payload.scope);
  });

  it('validates production auth secrets at startup', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        PULSE_PUBLIC_URL: 'https://pulse.example.com',
        PULSE_SESSION_SECRET: 'too-short',
      }),
    ).toThrow('PULSE_SESSION_SECRET must be set to at least 32 characters in production');
  });

  it('returns searchable indexed rooms', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom(indexedRoomInput);
    const app = createApp(loadConfig({}), { roomStore, identityService });

    const response = await app.request('/api/rooms?q=hardware');

    await expect(response.json()).resolves.toMatchObject({
      rooms: [
        {
          creator: {
            did: 'did:plc:creator',
            displayName: 'Creator',
            handle: 'creator.example',
          },
          name: 'Repair Cafe',
          server: {
            did: 'did:plc:pulseserver',
            baseUrl: 'https://pulse.example.com',
          },
          uri: 'at://did:plc:creator/app.pulse.room/room1',
        },
      ],
    });
  });

  it('returns the mobile-ready discovery alias with the same room shape', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom(indexedRoomInput);
    const app = createApp(loadConfig({}), { roomStore, identityService });

    const response = await app.request('/api/discovery/rooms?q=hardware');

    await expect(response.json()).resolves.toMatchObject({
      rooms: [
        {
          creator: {
            did: 'did:plc:creator',
            displayName: 'Creator',
            handle: 'creator.example',
          },
          name: 'Repair Cafe',
          server: {
            did: 'did:plc:pulseserver',
            baseUrl: 'https://pulse.example.com',
          },
          uri: 'at://did:plc:creator/app.pulse.room/room1',
        },
      ],
    });
  });

  it('returns room detail and policy by encoded AT URI', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom(indexedRoomInput);
    const app = createApp(loadConfig({}), { roomStore, identityService });
    const roomUri = encodeURIComponent(indexedRoomInput.uri);

    const detail = await app.request(`/api/rooms/${roomUri}`);
    const policy = await app.request(`/api/rooms/${roomUri}/policy`);

    await expect(detail.json()).resolves.toMatchObject({
      room: {
        name: 'Repair Cafe',
        uri: indexedRoomInput.uri,
      },
    });
    await expect(policy.json()).resolves.toEqual({
      roomUri: indexedRoomInput.uri,
      joinMode: 'open',
      visibility: 'public',
      requiresInvite: false,
      requestToSpeak: false,
      serverDid: 'did:plc:pulseserver',
    });
  });

  it('returns an anonymous mobile identity state without browser session support', async () => {
    const app = createApp(loadConfig({}));

    const response = await app.request('/api/identity/me');

    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });
  });

  it('creates private room invites locally and accepts them into membership', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom({
      ...indexedRoomInput,
      record: {
        ...indexedRoomInput.record,
        joinMode: 'invite',
      },
    });
    const { authStore, cookie } = await createTestAuth('did:plc:creator');
    const app = createApp(loadConfig({}), { roomStore, authStore });
    const roomUri = encodeURIComponent(indexedRoomInput.uri);

    const invite = await app.request(`/api/rooms/${roomUri}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ recipientDid: 'did:plc:invitee', expiresInSeconds: 3600 }),
    });

    expect(invite.status).toBe(201);
    const inviteBody = await invite.json();
    expect(inviteBody).toMatchObject({
      roomUri: indexedRoomInput.uri,
      expiresAt: expect.any(String),
    });
    expect(inviteBody.inviteId).toMatch(/^inv_/);

    const invitee = await createTestAuth('did:plc:invitee');
    const inviteeApp = createApp(loadConfig({}), { roomStore, authStore: invitee.authStore });
    const accepted = await inviteeApp.request(`/api/invites/${inviteBody.inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie },
    });

    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      inviteId: inviteBody.inviteId,
      roomUri: indexedRoomInput.uri,
      acceptedByDid: 'did:plc:invitee',
    });
    expect(roomStore.getMembership(indexedRoomInput.uri, 'did:plc:invitee')).toMatchObject({
      role: 'member',
    });
  });

  it('rejects private room voice tokens for non-members before media token minting', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom({
      ...indexedRoomInput,
      record: {
        ...indexedRoomInput.record,
        joinMode: 'invite',
      },
    });
    const app = createApp(loadConfig({}), { roomStore });

    const voiceToken = await app.request('/api/voice-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomUri: indexedRoomInput.uri, mode: 'listen' }),
    });

    expect(voiceToken.status).toBe(401);
    await expect(voiceToken.json()).resolves.toEqual({
      error: 'Sign in to join this private room.',
    });
  });

  it('lets owners remove and ban members from local room ACLs', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom({
      ...indexedRoomInput,
      record: {
        ...indexedRoomInput.record,
        joinMode: 'invite',
      },
    });
    const owner = await createTestAuth('did:plc:creator');
    const app = createApp(loadConfig({}), { roomStore, authStore: owner.authStore });
    const roomUri = encodeURIComponent(indexedRoomInput.uri);
    const invite = await app.request(`/api/rooms/${roomUri}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ recipientDid: 'did:plc:member' }),
    });
    const inviteBody = await invite.json();
    const member = await createTestAuth('did:plc:member');
    const memberApp = createApp(loadConfig({}), { roomStore, authStore: member.authStore });
    await memberApp.request(`/api/invites/${inviteBody.inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: member.cookie },
    });

    const removed = await app.request(`/api/rooms/${roomUri}/members/did:plc:member`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });

    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toEqual({
      roomUri: indexedRoomInput.uri,
      did: 'did:plc:member',
      status: 'removed',
    });
    expect(roomStore.getMembership(indexedRoomInput.uri, 'did:plc:member')).toBeNull();

    const banned = await app.request(`/api/rooms/${roomUri}/bans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ did: 'did:plc:member' }),
    });

    expect(banned.status).toBe(200);
    await expect(banned.json()).resolves.toEqual({
      roomUri: indexedRoomInput.uri,
      did: 'did:plc:member',
      status: 'banned',
    });
    expect(roomStore.isBanned(indexedRoomInput.uri, 'did:plc:member')).toBe(true);
  });

  it('still keeps media token minting explicit after authorized room access', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom(indexedRoomInput);
    const app = createApp(loadConfig({}), { roomStore });

    const voiceToken = await app.request('/api/voice-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomUri: indexedRoomInput.uri, mode: 'listen' }),
    });

    expect(voiceToken.status).toBe(501);
    await expect(voiceToken.json()).resolves.toEqual({
      error: 'Voice token minting requires configured media credentials and is not enabled yet.',
    });
  });
});
