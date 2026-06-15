import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { AtprotoIdentityService, IdentityCacheStore } from './service.js';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });

const createService = (fetch: typeof globalThis.fetch) => {
  const database = new DatabaseSync(':memory:');
  const store = new IdentityCacheStore(database);
  const service = new AtprotoIdentityService(store, 'https://bsky.social', {
    fetch,
    now: () => new Date('2026-06-15T00:00:00.000Z'),
  });

  return { service, store, database };
};

describe('AtprotoIdentityService', () => {
  it('resolves a DID principal with PDS and profile fields', async () => {
    const { service } = createService(async (url) => {
      const requestUrl = new URL(String(url));

      if (requestUrl.hostname === 'plc.directory') {
        return jsonResponse({
          service: [
            {
              id: '#atproto_pds',
              type: 'AtprotoPersonalDataServer',
              serviceEndpoint: 'https://pds.example.com',
            },
          ],
        });
      }

      expect(requestUrl.pathname).toBe('/xrpc/app.bsky.actor.getProfile');
      expect(requestUrl.searchParams.get('actor')).toBe('did:plc:alice');
      return jsonResponse({
        did: 'did:plc:alice',
        handle: 'alice.example',
        displayName: 'Alice',
        avatar: 'https://cdn.example.com/alice.png',
      });
    });

    await expect(service.getPrincipal('did:plc:alice')).resolves.toEqual({
      did: 'did:plc:alice',
      handle: 'alice.example',
      displayName: 'Alice',
      avatarUrl: 'https://cdn.example.com/alice.png',
      pdsEndpoint: 'https://pds.example.com',
      profileUpdatedAt: '2026-06-15T00:00:00.000Z',
    });
  });

  it('returns a DID-only fallback when remote identity lookup fails', async () => {
    const { service, store } = createService(
      async () => new Response('unavailable', { status: 503 }),
    );

    await expect(service.getPrincipal('did:plc:offline')).resolves.toEqual({
      did: 'did:plc:offline',
    });
    expect(store.get('did:plc:offline')?.failedAt).toBe('2026-06-15T00:00:00.000Z');
  });

  it('keeps handles mutable by trusting fresh handle resolution over cached DIDs', async () => {
    const resolvedDids = ['did:plc:old', 'did:plc:new'];
    const { service } = createService(async (url) => {
      const requestUrl = new URL(String(url));

      if (requestUrl.pathname === '/xrpc/com.atproto.identity.resolveHandle') {
        return jsonResponse({ did: resolvedDids.shift() });
      }

      if (requestUrl.hostname === 'plc.directory') {
        return jsonResponse({
          service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' }],
        });
      }

      return jsonResponse({
        did: requestUrl.searchParams.get('actor'),
        handle: 'alice.example',
      });
    });

    await expect(service.resolveHandle('@Alice.Example')).resolves.toMatchObject({
      did: 'did:plc:old',
      handle: 'alice.example',
    });
    await expect(service.resolveHandle('alice.example')).resolves.toMatchObject({
      did: 'did:plc:new',
      handle: 'alice.example',
    });
  });
});
