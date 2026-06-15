import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { PulseRoomIndexer } from './indexer.js';
import { RoomIndexStore } from './store.js';

const roomRecord = {
  $type: 'app.pulse.room',
  name: 'Local Audio Club',
  description: 'A room for self-hosters',
  createdAt: '2026-06-15T00:00:00.000Z',
  visibility: 'public',
  joinMode: 'open',
  tags: ['homelab', 'voice'],
  server: {
    $type: 'app.pulse.room.server',
    serviceDid: 'did:plc:pulseserver',
    baseUrl: 'https://pulse.example.com',
    createdAt: '2026-06-15T00:00:00.000Z',
  },
} as const;

describe('PulseRoomIndexer', () => {
  it('indexes searchable room records', () => {
    const store = new RoomIndexStore();
    const indexer = new PulseRoomIndexer(loadConfig({}), store);

    indexer.indexRecord('at://did:plc:creator/app.pulse.room/room1', 'bafyroom', roomRecord);

    expect(store.searchRooms({ query: 'homelab' })).toMatchObject([
      {
        uri: 'at://did:plc:creator/app.pulse.room/room1',
        cid: 'bafyroom',
        repo: 'did:plc:creator',
        rkey: 'room1',
        name: 'Local Audio Club',
        serverBaseUrl: 'https://pulse.example.com',
      },
    ]);
  });

  it('applies Jetstream updates and deletes idempotently', () => {
    const store = new RoomIndexStore();
    const indexer = new PulseRoomIndexer(loadConfig({}), store);

    indexer.applyJetstreamMessage({
      kind: 'commit',
      did: 'did:plc:creator',
      commit: {
        collection: 'app.pulse.room',
        rkey: 'room1',
        operation: 'create',
        cid: 'bafyroom',
        record: roomRecord,
      },
    });
    indexer.applyJetstreamMessage({
      kind: 'commit',
      did: 'did:plc:creator',
      commit: {
        collection: 'app.pulse.room',
        rkey: 'room1',
        operation: 'update',
        cid: 'bafyroom2',
        record: {
          ...roomRecord,
          name: 'Renamed Audio Club',
        },
      },
    });

    expect(store.searchRooms({ query: 'renamed' })).toHaveLength(1);

    indexer.applyJetstreamMessage({
      kind: 'commit',
      did: 'did:plc:creator',
      commit: {
        collection: 'app.pulse.room',
        rkey: 'room1',
        operation: 'delete',
      },
    });

    expect(store.searchRooms({ query: 'renamed' })).toEqual([]);
  });
});
