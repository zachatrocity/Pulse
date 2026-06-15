import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { AtprotoIdentityService, IdentityCacheStore } from './identity/service.js';
import { PulseRoomIndexer } from './rooms/indexer.js';
import { RoomIndexStore } from './rooms/store.js';

const config = loadConfig();
const roomStore = new RoomIndexStore(config.databasePath);
const identityService = new AtprotoIdentityService(
  new IdentityCacheStore(roomStore.database),
  config.atprotoPdsUrl,
);
const roomIndexer = new PulseRoomIndexer(config, roomStore);
const app = createApp(config, { roomStore, identityService });

roomIndexer.start().catch((error) => {
  console.error('Pulse room indexer failed to start', error);
});

const shutdown = () => {
  roomIndexer.stop();
  roomStore.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(`Pulse API listening on http://${info.address}:${info.port}`);
  },
);
