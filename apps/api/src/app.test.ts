import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
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

  it('keeps invite and voice-token contracts explicit before stateful features exist', async () => {
    const roomStore = new RoomIndexStore();
    roomStore.upsertRoom(indexedRoomInput);
    const app = createApp(loadConfig({}), { roomStore });
    const roomUri = encodeURIComponent(indexedRoomInput.uri);

    const invite = await app.request(`/api/rooms/${roomUri}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const voiceToken = await app.request('/api/voice-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomUri: indexedRoomInput.uri, mode: 'listen' }),
    });

    expect(invite.status).toBe(501);
    await expect(invite.json()).resolves.toEqual({
      error: 'Room invites require authenticated room membership and are not enabled yet.',
    });
    expect(voiceToken.status).toBe(501);
    await expect(voiceToken.json()).resolves.toEqual({
      error: 'Voice token minting requires configured media credentials and is not enabled yet.',
    });
  });
});
