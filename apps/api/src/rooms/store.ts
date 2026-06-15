import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { pulseLexiconIds } from '@pulse/shared';

import type { AtUri, Cid, Did, PulseRoomRecord } from '@pulse/shared';

export type IndexedRoom = {
  uri: AtUri;
  cid: Cid;
  repo: Did;
  rkey: string;
  name: string;
  description?: string;
  visibility: PulseRoomRecord['visibility'];
  joinMode: PulseRoomRecord['joinMode'];
  language?: string;
  tags: string[];
  serverDid: Did;
  serverBaseUrl: string;
  recordCreatedAt: string;
  recordUpdatedAt?: string;
  indexedAt: string;
};

export type RoomSearchOptions = {
  query?: string;
  limit?: number;
};

export class RoomIndexStore {
  readonly database: DatabaseSync;

  constructor(databasePath = ':memory:') {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  close() {
    this.database.close();
  }

  upsertRoom(input: {
    uri: AtUri;
    cid: Cid;
    repo: Did;
    rkey: string;
    record: PulseRoomRecord;
    indexedAt?: string;
  }) {
    const indexedAt = input.indexedAt ?? new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO indexed_rooms (
            uri, cid, repo, rkey, name, description, visibility, join_mode,
            language, tags_json, server_did, server_base_url, record_created_at,
            record_updated_at, indexed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uri) DO UPDATE SET
            cid = excluded.cid,
            name = excluded.name,
            description = excluded.description,
            visibility = excluded.visibility,
            join_mode = excluded.join_mode,
            language = excluded.language,
            tags_json = excluded.tags_json,
            server_did = excluded.server_did,
            server_base_url = excluded.server_base_url,
            record_created_at = excluded.record_created_at,
            record_updated_at = excluded.record_updated_at,
            indexed_at = excluded.indexed_at
        `,
      )
      .run(
        input.uri,
        input.cid,
        input.repo,
        input.rkey,
        input.record.name,
        input.record.description ?? null,
        input.record.visibility,
        input.record.joinMode,
        input.record.language ?? null,
        JSON.stringify(input.record.tags ?? []),
        input.record.server.serviceDid,
        input.record.server.baseUrl,
        input.record.createdAt,
        input.record.updatedAt ?? null,
        indexedAt,
      );
  }

  deleteRoom(uri: AtUri) {
    this.database.prepare('DELETE FROM indexed_rooms WHERE uri = ?').run(uri);
  }

  searchRooms(options: RoomSearchOptions = {}): IndexedRoom[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const query = options.query?.trim();

    const rows = query
      ? this.database
          .prepare(
            `
              SELECT * FROM indexed_rooms
              WHERE visibility IN ('public', 'inviteOnlyListing')
                AND (
                  lower(name) LIKE lower(?)
                  OR lower(COALESCE(description, '')) LIKE lower(?)
                  OR lower(tags_json) LIKE lower(?)
                )
              ORDER BY indexed_at DESC, record_created_at DESC
              LIMIT ?
            `,
          )
          .all(`%${query}%`, `%${query}%`, `%${query}%`, limit)
      : this.database
          .prepare(
            `
              SELECT * FROM indexed_rooms
              WHERE visibility IN ('public', 'inviteOnlyListing')
              ORDER BY indexed_at DESC, record_created_at DESC
              LIMIT ?
            `,
          )
          .all(limit);

    return rows.map(mapRoomRow);
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS indexed_rooms (
        uri TEXT PRIMARY KEY,
        cid TEXT NOT NULL,
        repo TEXT NOT NULL,
        rkey TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        visibility TEXT NOT NULL,
        join_mode TEXT NOT NULL,
        language TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        server_did TEXT NOT NULL,
        server_base_url TEXT NOT NULL,
        record_created_at TEXT NOT NULL,
        record_updated_at TEXT,
        indexed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS indexed_rooms_repo_idx ON indexed_rooms(repo);
      CREATE INDEX IF NOT EXISTS indexed_rooms_visibility_idx ON indexed_rooms(visibility);
      CREATE INDEX IF NOT EXISTS indexed_rooms_indexed_at_idx ON indexed_rooms(indexed_at);
    `);
  }
}

const mapRoomRow = (row: unknown): IndexedRoom => {
  const room = row as {
    uri: string;
    cid: string;
    repo: string;
    rkey: string;
    name: string;
    description: string | null;
    visibility: PulseRoomRecord['visibility'];
    join_mode: PulseRoomRecord['joinMode'];
    language: string | null;
    tags_json: string;
    server_did: string;
    server_base_url: string;
    record_created_at: string;
    record_updated_at: string | null;
    indexed_at: string;
  };

  return {
    uri: room.uri as AtUri,
    cid: room.cid,
    repo: room.repo as Did,
    rkey: room.rkey,
    name: room.name,
    description: room.description ?? undefined,
    visibility: room.visibility,
    joinMode: room.join_mode,
    language: room.language ?? undefined,
    tags: JSON.parse(room.tags_json) as string[],
    serverDid: room.server_did as Did,
    serverBaseUrl: room.server_base_url,
    recordCreatedAt: room.record_created_at,
    recordUpdatedAt: room.record_updated_at ?? undefined,
    indexedAt: room.indexed_at,
  };
};

export const parseRoomUri = (uri: string) => {
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
