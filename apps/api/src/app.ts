import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { appInfo, healthSchema } from '@pulse/shared';

import { registerAuthRoutes } from './auth/routes.js';
import { FileAuthStore } from './auth/store.js';
import type { RuntimeConfig } from './config.js';

export const createApp = (config: RuntimeConfig) => {
  const app = new Hono();
  const authStore = FileAuthStore.fromDataDir(config.dataDir);

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

  if (config.nodeEnv === 'production') {
    app.use('*', serveStatic({ root: './apps/web/dist' }));
    app.get('*', serveStatic({ path: './apps/web/dist/index.html' }));
  }

  return app;
};
