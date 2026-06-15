import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  apiErrorSchema,
  appInfo,
  authStatusSchema,
  createInviteRequestSchema,
  createRoomRequestSchema,
  createRoomResponseSchema,
  healthSchema,
  identityResolveResponseSchema,
  roomDetailResponseSchema,
  roomListResponseSchema,
  roomPolicyResponseSchema,
  roomSearchResponseSchema,
  pulseLexiconIds,
  updateRoomRequestSchema,
  updateRoomResponseSchema,
  voiceTokenRequestSchema,
} from '@pulse/shared';

import type { AtUri, HttpsUrl, PulseRoomRecord } from '@pulse/shared';

import { sessionCookieName } from './auth/cookies.js';
import { createOAuthClient } from './auth/oauth.js';
import { getCurrentWebSession, registerAuthRoutes } from './auth/routes.js';
import { FileAuthStore } from './auth/store.js';
import type { FileAuthStore as AuthStore } from './auth/store.js';
import type { RuntimeConfig } from './config.js';
import { AtprotoIdentityService, IdentityCacheStore } from './identity/service.js';
import { OAuthRoomRecordPublisher } from './rooms/publisher.js';
import type { AtprotoRepoSession, RoomRecordPublisher } from './rooms/publisher.js';
import { RoomIndexStore } from './rooms/store.js';

import type { Did, IdentityPrincipal, RoomSummary } from '@pulse/shared';
import type { IndexedRoom } from './rooms/store.js';

export type AppDependencies = {
  authStore?: AuthStore;
  roomStore?: RoomIndexStore;
  identityService?: AtprotoIdentityService;
  roomRecordPublisher?: RoomRecordPublisher;
  restoreOAuthSession?: (did: Did) => Promise<AtprotoRepoSession>;
};

export const createApp = (config: RuntimeConfig, dependencies: AppDependencies = {}) => {
  const app = new Hono();
  const authStore = dependencies.authStore ?? FileAuthStore.fromDataDir(config.dataDir);
  const roomStore = dependencies.roomStore ?? new RoomIndexStore();
  const identityService =
    dependencies.identityService ??
    new AtprotoIdentityService(new IdentityCacheStore(roomStore.database), config.atprotoPdsUrl);
  const roomRecordPublisher = dependencies.roomRecordPublisher ?? new OAuthRoomRecordPublisher();
  const restoreOAuthSession =
    dependencies.restoreOAuthSession ??
    (async (did: Did) => {
      const oauthClient = await createOAuthClient(config, authStore);
      const session = await oauthClient.restore(did);
      return {
        did: session.did as Did,
        fetchHandler: session.fetchHandler.bind(session),
      };
    });

  app.use(
    '/api/*',
    cors({
      origin: config.webOrigin,
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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

  app.post('/api/rooms', async (c) => {
    const current = await getCurrentWebSession({
      config,
      store: authStore,
      cookie: getCookie(c, sessionCookieName),
    });
    if (!current) {
      return c.json(apiErrorSchema.parse({ error: 'Sign in to create a room.' }), 401);
    }

    const payload = createRoomRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!payload.success) {
      return c.json(apiErrorSchema.parse({ error: 'Room details are invalid.' }), 400);
    }

    try {
      const oauthSession = await restoreOAuthSession(current.session.did as Did);
      const now = new Date().toISOString();
      const record = buildRoomRecord({
        now,
        title: payload.data.title,
        description: payload.data.description,
        visibility: payload.data.visibility,
        joinMode: payload.data.joinMode,
        language: payload.data.language,
        tags: payload.data.tags,
        config,
      });
      const published = await roomRecordPublisher.createRoomRecord(oauthSession, record);
      const parsed = parsePublishedRoomUri(published.uri);
      if (!parsed) {
        return c.json(apiErrorSchema.parse({ error: 'PDS returned an invalid room URI.' }), 502);
      }

      roomStore.upsertRoom({
        uri: published.uri,
        cid: published.cid,
        repo: parsed.repo,
        rkey: published.rkey,
        record: published.record,
        indexedAt: now,
      });
      roomStore.upsertRoomRuntimeState({
        roomUri: published.uri,
        ownerDid: parsed.repo,
        serverDid: config.serverDid as Did,
        serverBaseUrl: config.publicUrl,
        visibility: published.record.visibility,
        joinMode: published.record.joinMode,
        createdAt: now,
        updatedAt: now,
      });

      const principals = await identityService.getPrincipals([parsed.repo, config.serverDid as Did]);
      const room = roomStore.getRoom(published.uri);
      if (!room) {
        return c.json(apiErrorSchema.parse({ error: 'Room was published but not indexed.' }), 500);
      }

      return c.json(createRoomResponseSchema.parse({ room: mapRoomSummary(room, principals) }), 201);
    } catch (error) {
      console.error('Pulse room creation failed', error);
      return c.json(apiErrorSchema.parse({ error: 'Could not publish the room record.' }), 502);
    }
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

  app.patch('/api/rooms/:roomUri', async (c) => {
    const roomUri = decodeRoomUri(c.req.param('roomUri'));
    if (!roomUri) {
      return c.json(apiErrorSchema.parse({ error: 'Room URI must be URL-encoded.' }), 400);
    }

    const current = await getCurrentWebSession({
      config,
      store: authStore,
      cookie: getCookie(c, sessionCookieName),
    });
    if (!current) {
      return c.json(apiErrorSchema.parse({ error: 'Sign in to update a room.' }), 401);
    }

    const room = roomStore.getRoom(roomUri);
    if (!room) {
      return c.json(apiErrorSchema.parse({ error: 'Room not found.' }), 404);
    }
    if (room.repo !== current.session.did) {
      return c.json(
        apiErrorSchema.parse({ error: 'Only the room owner can update this room.' }),
        403,
      );
    }

    const payload = updateRoomRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!payload.success) {
      return c.json(apiErrorSchema.parse({ error: 'Room update is invalid.' }), 400);
    }

    try {
      const oauthSession = await restoreOAuthSession(current.session.did as Did);
      const now = new Date().toISOString();
      const record: PulseRoomRecord = {
        $type: pulseLexiconIds.room,
        name: payload.data.title ?? room.name,
        description: 'description' in payload.data ? payload.data.description : room.description,
        createdAt: room.recordCreatedAt,
        updatedAt: now,
        visibility: payload.data.visibility ?? room.visibility,
        joinMode: payload.data.joinMode ?? room.joinMode,
        language: 'language' in payload.data ? payload.data.language : room.language,
        tags: payload.data.tags ?? room.tags,
        server: {
          $type: pulseLexiconIds.roomServer,
          serviceDid: room.serverDid,
          baseUrl: room.serverBaseUrl as HttpsUrl,
          createdAt: room.recordCreatedAt,
          updatedAt: now,
        },
      };
      const published = await roomRecordPublisher.updateRoomRecord(oauthSession, {
        repo: room.repo,
        rkey: room.rkey,
        record,
      });

      roomStore.upsertRoom({
        uri: room.uri,
        cid: published.cid,
        repo: room.repo,
        rkey: room.rkey,
        record: published.record,
        indexedAt: now,
      });
      roomStore.upsertRoomRuntimeState({
        roomUri: room.uri,
        ownerDid: room.repo,
        serverDid: published.record.server.serviceDid,
        serverBaseUrl: published.record.server.baseUrl,
        visibility: published.record.visibility,
        joinMode: published.record.joinMode,
        updatedAt: now,
      });

      const principals = await identityService.getPrincipals([room.repo, room.serverDid]);
      const updatedRoom = roomStore.getRoom(room.uri);
      if (!updatedRoom) {
        return c.json(apiErrorSchema.parse({ error: 'Room was published but not indexed.' }), 500);
      }

      return c.json(
        updateRoomResponseSchema.parse({ room: mapRoomSummary(updatedRoom, principals) }),
      );
    } catch (error) {
      console.error('Pulse room update failed', error);
      return c.json(apiErrorSchema.parse({ error: 'Could not publish the room update.' }), 502);
    }
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
    const runtimeState = roomStore.getRoomRuntimeState(roomUri);
    const joinMode = runtimeState?.joinMode ?? room.joinMode;

    return c.json(
      roomPolicyResponseSchema.parse({
        roomUri,
        joinMode,
        visibility: runtimeState?.visibility ?? room.visibility,
        requiresInvite: joinMode === 'invite',
        requestToSpeak: joinMode !== 'open',
        serverDid: runtimeState?.serverDid ?? room.serverDid,
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

const parsePublishedRoomUri = (uri: string): { repo: Did; rkey: string } | null => {
  const prefix = 'at://';
  if (!uri.startsWith(prefix)) {
    return null;
  }

  const [repo, collection, rkey] = uri.slice(prefix.length).split('/');
  if (!repo || collection !== pulseLexiconIds.room || !rkey) {
    return null;
  }

  return { repo: repo as Did, rkey };
};

const buildRoomRecord = (input: {
  now: string;
  title: string;
  description?: string;
  visibility: PulseRoomRecord['visibility'];
  joinMode: PulseRoomRecord['joinMode'];
  language?: string;
  tags: string[];
  config: RuntimeConfig;
}): PulseRoomRecord => ({
  $type: pulseLexiconIds.room,
  name: input.title,
  description: input.description,
  createdAt: input.now,
  visibility: input.visibility,
  joinMode: input.joinMode,
  language: input.language,
  tags: input.tags,
  server: {
    $type: pulseLexiconIds.roomServer,
    serviceDid: input.config.serverDid as Did,
    baseUrl: input.config.publicUrl as HttpsUrl,
    createdAt: input.now,
    software: 'Pulse',
    version: appInfo.version,
  },
});

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
