import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  apiErrorSchema,
  appInfo,
  healthSchema,
  identityResolveResponseSchema,
  roomSearchResponseSchema,
} from '@pulse/shared';

import { registerAuthRoutes } from './auth/routes.js';
import { FileAuthStore } from './auth/store.js';
import type { RuntimeConfig } from './config.js';
import { AtprotoIdentityService, IdentityCacheStore } from './identity/service.js';
import { RoomIndexStore } from './rooms/store.js';

import type { Did, IdentityPrincipal, RoomSummary } from '@pulse/shared';
import type { IndexedRoom } from './rooms/store.js';

export type AppDependencies = {
  roomStore?: RoomIndexStore;
  identityService?: AtprotoIdentityService;
};

export const createApp = (config: RuntimeConfig, dependencies: AppDependencies = {}) => {
  const app = new Hono();
  const authStore = FileAuthStore.fromDataDir(config.dataDir);
  const roomStore = dependencies.roomStore ?? new RoomIndexStore();
  const identityService =
    dependencies.identityService ??
    new AtprotoIdentityService(new IdentityCacheStore(roomStore.database), config.atprotoPdsUrl);

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

  app.get('/api/identity/resolve', async (c) => {
    const handle = c.req.query('handle')?.trim();
    if (!handle) {
      return c.json(apiErrorSchema.parse({ error: 'Handle is required.' }), 400);
    }

    const identity = await identityService.resolveHandle(handle);
    if (!identity) {
      return c.json(apiErrorSchema.parse({ error: 'Could not resolve that handle.' }), 404);
    }

    return c.json(identityResolveResponseSchema.parse({ identity }));
  });

  app.get('/api/rooms', async (c) => {
    const query = c.req.query('q');
    const limit = parseLimit(c.req.query('limit'));
    const rooms = roomStore.searchRooms({ query, limit });
    const principals = await identityService.getPrincipals(
      rooms.flatMap((room) => [room.repo, room.serverDid]),
    );

    return c.json(
      roomSearchResponseSchema.parse({
        rooms: rooms.map((room) => mapRoomSummary(room, principals)),
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

const mapRoomSummary = (
  room: IndexedRoom,
  principals: Map<Did, IdentityPrincipal>,
): RoomSummary => ({
  uri: room.uri,
  cid: room.cid,
  rkey: room.rkey,
  name: room.name,
  description: room.description,
  visibility: room.visibility,
  joinMode: room.joinMode,
  language: room.language,
  tags: room.tags,
  creator: principals.get(room.repo) ?? { did: room.repo },
  server: {
    ...(principals.get(room.serverDid) ?? { did: room.serverDid }),
    baseUrl: room.serverBaseUrl,
  },
  recordCreatedAt: room.recordCreatedAt,
  recordUpdatedAt: room.recordUpdatedAt,
  indexedAt: room.indexedAt,
});
