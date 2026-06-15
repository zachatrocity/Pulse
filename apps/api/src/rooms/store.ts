import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

export type RoomMembershipRole = 'owner' | 'member';

export type RoomMembership = {
  roomUri: AtUri;
  did: Did;
  role: RoomMembershipRole;
  createdAt: string;
  updatedAt: string;
};

export type RoomInvite = {
  id: string;
  roomUri: AtUri;
  createdByDid: Did;
  recipientDid?: Did;
  acceptedByDid?: Did;
  acceptedAt?: string;
  expiresAt?: string;
  createdAt: string;
};

export type RoomAccessDecision =
  | { allowed: true; role?: RoomMembershipRole }
  | { allowed: false; reason: 'authentication_required' | 'not_member' | 'banned' };

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

    this.ensureRoomOwner(input.uri, input.repo);
  }

  deleteRoom(uri: AtUri) {
    this.database.prepare('DELETE FROM indexed_rooms WHERE uri = ?').run(uri);
  }

  getRoom(uri: AtUri): IndexedRoom | null {
    const row = this.database.prepare('SELECT * FROM indexed_rooms WHERE uri = ?').get(uri);
    return row ? mapRoomRow(row) : null;
  }

  getMembership(roomUri: AtUri, did: Did): RoomMembership | null {
    const row = this.database
      .prepare('SELECT * FROM room_memberships WHERE room_uri = ? AND did = ?')
      .get(roomUri, did);
    return row ? mapMembershipRow(row) : null;
  }

  listMemberships(roomUri: AtUri): RoomMembership[] {
    return this.database
      .prepare(
        'SELECT * FROM room_memberships WHERE room_uri = ? ORDER BY role DESC, created_at ASC',
      )
      .all(roomUri)
      .map(mapMembershipRow);
  }

  createInvite(input: {
    roomUri: AtUri;
    createdByDid: Did;
    recipientDid?: Did;
    expiresInSeconds?: number;
  }): RoomInvite {
    const now = new Date();
    const expiresAt = input.expiresInSeconds
      ? new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString()
      : undefined;
    const invite: RoomInvite = {
      id: `inv_${randomUUID()}`,
      roomUri: input.roomUri,
      createdByDid: input.createdByDid,
      recipientDid: input.recipientDid,
      expiresAt,
      createdAt: now.toISOString(),
    };

    this.database
      .prepare(
        `
          INSERT INTO room_invites (
            id, room_uri, created_by_did, recipient_did, expires_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        invite.id,
        invite.roomUri,
        invite.createdByDid,
        invite.recipientDid ?? null,
        invite.expiresAt ?? null,
        invite.createdAt,
      );

    return invite;
  }

  acceptInvite(inviteId: string, did: Did): RoomInvite | null {
    const invite = this.getInvite(inviteId);
    if (!invite || invite.acceptedAt) {
      return null;
    }

    if (invite.recipientDid && invite.recipientDid !== did) {
      return null;
    }

    if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) {
      return null;
    }

    if (this.isBanned(invite.roomUri, did)) {
      return null;
    }

    const now = new Date().toISOString();
    this.addMembership(invite.roomUri, did, 'member');
    this.database
      .prepare('UPDATE room_invites SET accepted_by_did = ?, accepted_at = ? WHERE id = ?')
      .run(did, now, inviteId);

    return this.getInvite(inviteId);
  }

  getInvite(inviteId: string): RoomInvite | null {
    const row = this.database.prepare('SELECT * FROM room_invites WHERE id = ?').get(inviteId);
    return row ? mapInviteRow(row) : null;
  }

  removeMembership(roomUri: AtUri, did: Did): boolean {
    const membership = this.getMembership(roomUri, did);
    if (!membership || membership.role === 'owner') {
      return false;
    }

    const result = this.database
      .prepare('DELETE FROM room_memberships WHERE room_uri = ? AND did = ?')
      .run(roomUri, did);
    return result.changes > 0;
  }

  banMember(roomUri: AtUri, did: Did, bannedByDid: Did): boolean {
    const membership = this.getMembership(roomUri, did);
    if (membership?.role === 'owner') {
      return false;
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO room_bans (room_uri, did, banned_by_did, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(room_uri, did) DO UPDATE SET
            banned_by_did = excluded.banned_by_did,
            created_at = excluded.created_at
        `,
      )
      .run(roomUri, did, bannedByDid, now);
    this.database
      .prepare('DELETE FROM room_memberships WHERE room_uri = ? AND did = ? AND role != ?')
      .run(roomUri, did, 'owner');
    return true;
  }

  isBanned(roomUri: AtUri, did: Did): boolean {
    const row = this.database
      .prepare('SELECT 1 FROM room_bans WHERE room_uri = ? AND did = ?')
      .get(roomUri, did);
    return Boolean(row);
  }

  canAccessRoom(room: IndexedRoom, did: Did | null): RoomAccessDecision {
    if (did && this.isBanned(room.uri, did)) {
      return { allowed: false, reason: 'banned' };
    }

    if (room.joinMode !== 'invite') {
      return { allowed: true, role: did ? this.getMembership(room.uri, did)?.role : undefined };
    }

    if (!did) {
      return { allowed: false, reason: 'authentication_required' };
    }

    const membership = this.getMembership(room.uri, did);
    return membership
      ? { allowed: true, role: membership.role }
      : { allowed: false, reason: 'not_member' };
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

  private addMembership(roomUri: AtUri, did: Did, role: RoomMembershipRole) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO room_memberships (room_uri, did, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(room_uri, did) DO UPDATE SET
            role = CASE
              WHEN room_memberships.role = 'owner' THEN room_memberships.role
              ELSE excluded.role
            END,
            updated_at = excluded.updated_at
        `,
      )
      .run(roomUri, did, role, now, now);
  }

  private ensureRoomOwner(roomUri: AtUri, did: Did) {
    this.addMembership(roomUri, did, 'owner');
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

      CREATE TABLE IF NOT EXISTS room_memberships (
        room_uri TEXT NOT NULL REFERENCES indexed_rooms(uri) ON DELETE CASCADE,
        did TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (room_uri, did)
      );

      CREATE INDEX IF NOT EXISTS room_memberships_did_idx ON room_memberships(did);

      CREATE TABLE IF NOT EXISTS room_invites (
        id TEXT PRIMARY KEY,
        room_uri TEXT NOT NULL REFERENCES indexed_rooms(uri) ON DELETE CASCADE,
        created_by_did TEXT NOT NULL,
        recipient_did TEXT,
        accepted_by_did TEXT,
        accepted_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS room_invites_room_uri_idx ON room_invites(room_uri);
      CREATE INDEX IF NOT EXISTS room_invites_recipient_did_idx ON room_invites(recipient_did);

      CREATE TABLE IF NOT EXISTS room_bans (
        room_uri TEXT NOT NULL REFERENCES indexed_rooms(uri) ON DELETE CASCADE,
        did TEXT NOT NULL,
        banned_by_did TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_uri, did)
      );

      CREATE INDEX IF NOT EXISTS room_bans_did_idx ON room_bans(did);

      INSERT OR IGNORE INTO room_memberships (room_uri, did, role, created_at, updated_at)
      SELECT uri, repo, 'owner', indexed_at, indexed_at FROM indexed_rooms;
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

const mapMembershipRow = (row: unknown): RoomMembership => {
  const membership = row as {
    room_uri: string;
    did: string;
    role: RoomMembershipRole;
    created_at: string;
    updated_at: string;
  };

  return {
    roomUri: membership.room_uri as AtUri,
    did: membership.did as Did,
    role: membership.role,
    createdAt: membership.created_at,
    updatedAt: membership.updated_at,
  };
};

const mapInviteRow = (row: unknown): RoomInvite => {
  const invite = row as {
    id: string;
    room_uri: string;
    created_by_did: string;
    recipient_did: string | null;
    accepted_by_did: string | null;
    accepted_at: string | null;
    expires_at: string | null;
    created_at: string;
  };

  return {
    id: invite.id,
    roomUri: invite.room_uri as AtUri,
    createdByDid: invite.created_by_did as Did,
    recipientDid: invite.recipient_did ? (invite.recipient_did as Did) : undefined,
    acceptedByDid: invite.accepted_by_did ? (invite.accepted_by_did as Did) : undefined,
    acceptedAt: invite.accepted_at ?? undefined,
    expiresAt: invite.expires_at ?? undefined,
    createdAt: invite.created_at,
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
