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
});
