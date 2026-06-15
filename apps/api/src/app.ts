import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { appInfo, healthSchema } from '@pulse/shared';

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

    return c.json({
      rooms: roomStore.searchRooms({ query, limit }),
    });
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
