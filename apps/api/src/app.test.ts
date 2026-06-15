import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

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
});
