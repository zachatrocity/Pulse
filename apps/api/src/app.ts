import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  apiErrorSchema,
  appInfo,
  authStatusSchema,
  createInviteRequestSchema,
  healthSchema,
  identityResolveResponseSchema,
  roomDetailResponseSchema,
  roomListResponseSchema,
  roomPolicyResponseSchema,
  roomSearchResponseSchema,
  voiceTokenRequestSchema,
} from '@pulse/shared';

import type { AtUri } from '@pulse/shared';

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
      roomListResponseSchema.parse({
        rooms: rooms.map((room) => mapRoomSummary(room, principals)),
      }),
    );
  });

  app.get('/api/rooms/:roomUri', async (c) => {
    const roomUri = decodeRoomUri(c.req.param('roomUri'));
    if (!roomUri) {
      return c.json(apiErrorSchema.parse({ error: 'Room URI must be URL-encoded.' }), 400);
    }

    const room = roomStore.getRoom(roomUri);
    if (!room) {
      return c.json(apiErrorSchema.parse({ error: 'Room not found.' }), 404);
    }

    const principals = await identityService.getPrincipals([room.repo, room.serverDid]);
    return c.json(roomDetailResponseSchema.parse({ room: mapRoomSummary(room, principals) }));
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

  app.get('/api/discovery/rooms', async (c) => {
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

const decodeRoomUri = (value: string): AtUri | null => {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith('at://') ? (decoded as AtUri) : null;
  } catch {
    return null;
  }
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
