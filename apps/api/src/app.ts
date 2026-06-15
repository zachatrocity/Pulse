import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  apiErrorSchema,
  appInfo,
  authStatusSchema,
  createInviteRequestSchema,
  healthSchema,
  roomDetailResponseSchema,
  roomListResponseSchema,
  roomPolicyResponseSchema,
  voiceTokenRequestSchema,
} from '@pulse/shared';

import type { AtUri } from '@pulse/shared';

import { registerAuthRoutes } from './auth/routes.js';
import { FileAuthStore } from './auth/store.js';
import type { RuntimeConfig } from './config.js';
import { RoomIndexStore } from './rooms/store.js';

export type AppDependencies = {
  roomStore?: RoomIndexStore;
};

export const createApp = (config: RuntimeConfig, dependencies: AppDependencies = {}) => {
  const app = new Hono();
  const authStore = FileAuthStore.fromDataDir(config.dataDir);
  const roomStore = dependencies.roomStore ?? new RoomIndexStore();

  app.use(
    '/api/*',
    cors({
      origin: config.webOrigin,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  );

  app.get('/healthz', (c) =>
    c.json(
      healthSchema.parse({
        ok: true,
        service: 'pulse-api',
        version: appInfo.version,
      }),
    ),
  );

  app.get('/api/info', (c) => c.json(appInfo));

  registerAuthRoutes(app, { config, store: authStore });

  app.get('/api/rooms', (c) => {
    const query = c.req.query('q');
    const limit = parseLimit(c.req.query('limit'));

    return c.json(
      roomListResponseSchema.parse({
        rooms: roomStore.searchRooms({ query, limit }),
      }),
    );
  });

  app.get('/api/rooms/:roomUri', (c) => {
    const roomUri = decodeRoomUri(c.req.param('roomUri'));
    if (!roomUri) {
      return c.json(apiErrorSchema.parse({ error: 'Room URI must be URL-encoded.' }), 400);
    }

    const room = roomStore.getRoom(roomUri);
    if (!room) {
      return c.json(apiErrorSchema.parse({ error: 'Room not found.' }), 404);
    }

    return c.json(roomDetailResponseSchema.parse({ room }));
  });

  app.get('/api/rooms/:roomUri/policy', (c) => {
    const roomUri = decodeRoomUri(c.req.param('roomUri'));
    if (!roomUri) {
      return c.json(apiErrorSchema.parse({ error: 'Room URI must be URL-encoded.' }), 400);
    }

    const room = roomStore.getRoom(roomUri);
    if (!room) {
      return c.json(apiErrorSchema.parse({ error: 'Room not found.' }), 404);
    }

    return c.json(
      roomPolicyResponseSchema.parse({
        roomUri,
        joinMode: room.joinMode,
        visibility: room.visibility,
        requiresInvite: room.joinMode === 'invite',
        requestToSpeak: room.joinMode !== 'open',
        serverDid: room.serverDid,
      }),
    );
  });

  app.post('/api/rooms/:roomUri/invites', async (c) => {
    const roomUri = decodeRoomUri(c.req.param('roomUri'));
    if (!roomUri) {
      return c.json(apiErrorSchema.parse({ error: 'Room URI must be URL-encoded.' }), 400);
    }

    const payload = createInviteRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!payload.success) {
      return c.json(apiErrorSchema.parse({ error: 'Invite request is invalid.' }), 400);
    }

    if (!roomStore.getRoom(roomUri)) {
      return c.json(apiErrorSchema.parse({ error: 'Room not found.' }), 404);
    }

    return c.json(
      apiErrorSchema.parse({
        error: 'Room invites require authenticated room membership and are not enabled yet.',
      }),
      501,
    );
  });

  app.post('/api/voice-token', async (c) => {
    const payload = voiceTokenRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!payload.success) {
      return c.json(apiErrorSchema.parse({ error: 'Room URI and voice mode are required.' }), 400);
    }

    const room = roomStore.getRoom(payload.data.roomUri as AtUri);
    if (!room) {
      return c.json(apiErrorSchema.parse({ error: 'Room not found.' }), 404);
    }

    return c.json(
      apiErrorSchema.parse({
        error: 'Voice token minting requires configured media credentials and is not enabled yet.',
      }),
      501,
    );
  });

  app.get('/api/identity/me', (c) =>
    c.json(
      authStatusSchema.parse({
        authenticated: false,
      }),
    ),
  );

  app.get('/api/discovery/rooms', (c) => {
    const query = c.req.query('q');
    const limit = parseLimit(c.req.query('limit'));

    return c.json(
      roomListResponseSchema.parse({
        rooms: roomStore.searchRooms({ query, limit }),
      }),
    );
  });

  if (config.nodeEnv === 'production') {
    app.use('*', serveStatic({ root: './apps/web/dist' }));
    app.get('*', serveStatic({ path: './apps/web/dist/index.html' }));
  }

  return app;
};

const parseLimit = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const decodeRoomUri = (value: string): AtUri | null => {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith('at://') ? (decoded as AtUri) : null;
  } catch {
    return null;
  }
};
