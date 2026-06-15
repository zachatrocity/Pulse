import { pulseLexiconIds } from '@pulse/shared';

import type { AtUri, Cid, Did, PulseRoomRecord } from '@pulse/shared';
import type { RuntimeConfig } from '../config.js';
import type { RoomIndexStore } from './store.js';

type AtprotoListRecordsResponse = {
  cursor?: string;
  records: Array<{
    uri: AtUri;
    cid: Cid;
    value: unknown;
  }>;
};

type JetstreamCommitEvent = {
  kind: 'commit';
  did: Did;
  commit: {
    collection?: string;
    rkey?: string;
    cid?: Cid | null;
    record?: unknown;
    operation?: 'create' | 'update' | 'delete';
  };
};

export class PulseRoomIndexer {
  private jetstream?: WebSocket;
  private stopped = false;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: RoomIndexStore,
  ) {}

  async start() {
    await this.backfillKnownRepos();
    this.startJetstream();
  }

  stop() {
    this.stopped = true;
    this.jetstream?.close();
  }

  async backfillKnownRepos() {
    for (const repo of this.config.indexerRepos) {
      await this.backfillRepo(repo as Did);
    }
  }

  async backfillRepo(repo: Did) {
    let cursor: string | undefined;

    do {
      const url = new URL('/xrpc/com.atproto.repo.listRecords', this.config.atprotoPdsUrl);
      url.searchParams.set('repo', repo);
      url.searchParams.set('collection', pulseLexiconIds.room);
      url.searchParams.set('limit', '100');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to backfill ${repo}: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as AtprotoListRecordsResponse;
      for (const record of payload.records) {
        this.indexRecord(record.uri, record.cid, record.value);
      }
      cursor = payload.cursor;
    } while (cursor);
  }

  indexRecord(uri: AtUri, cid: Cid, value: unknown) {
    const parsed = parseAtUri(uri);
    const record = parsePulseRoomRecord(value);
    if (!parsed || !record) {
      return;
    }

    this.store.upsertRoom({
      uri,
      cid,
      repo: parsed.repo,
      rkey: parsed.rkey,
      record,
    });
  }

  applyJetstreamMessage(message: unknown) {
    if (!isJetstreamCommitEvent(message)) {
      return;
    }

    const { did, commit } = message;
    if (commit.collection !== pulseLexiconIds.room || !commit.rkey) {
      return;
    }

    const uri = `at://${did}/${pulseLexiconIds.room}/${commit.rkey}` as AtUri;
    if (commit.operation === 'delete') {
      this.store.deleteRoom(uri);
      return;
    }

    if (!commit.cid || !commit.record) {
      return;
    }

    this.indexRecord(uri, commit.cid, commit.record);
  }

  private startJetstream() {
    if (!this.config.indexerJetstreamUrl || this.stopped) {
      return;
    }

    const url = new URL(this.config.indexerJetstreamUrl);
    url.searchParams.append('wantedCollections', pulseLexiconIds.room);

    this.jetstream = new WebSocket(url);
    this.jetstream.addEventListener('message', (event) => {
      try {
        this.applyJetstreamMessage(JSON.parse(String(event.data)));
      } catch (error) {
        console.error('Failed to process Pulse room indexer event', error);
      }
    });
    this.jetstream.addEventListener('close', () => {
      if (!this.stopped) {
        setTimeout(() => this.startJetstream(), 5_000);
      }
    });
    this.jetstream.addEventListener('error', (event) => {
      console.error('Pulse room indexer Jetstream error', event);
    });
  }
}

export const parsePulseRoomRecord = (value: unknown): PulseRoomRecord | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (value.$type && value.$type !== pulseLexiconIds.room) {
    return null;
  }

  const server = value.server;
  if (!isRecord(server)) {
    return null;
  }

  if (
    typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !isRoomVisibility(value.visibility) ||
    !isRoomJoinMode(value.joinMode) ||
    typeof server.serviceDid !== 'string' ||
    typeof server.baseUrl !== 'string' ||
    typeof server.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    $type: value.$type === pulseLexiconIds.room ? value.$type : undefined,
    name: value.name,
    description: optionalString(value.description),
    createdAt: value.createdAt,
    updatedAt: optionalString(value.updatedAt),
    visibility: value.visibility,
    joinMode: value.joinMode,
    language: optionalString(value.language),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined,
    server: {
      $type: server.$type === pulseLexiconIds.roomServer ? server.$type : undefined,
      serviceDid: server.serviceDid as PulseRoomRecord['server']['serviceDid'],
      baseUrl: server.baseUrl as PulseRoomRecord['server']['baseUrl'],
      createdAt: server.createdAt,
      updatedAt: optionalString(server.updatedAt),
      software: optionalString(server.software),
      version: optionalString(server.version),
      policyUrl:
        typeof server.policyUrl === 'string'
          ? (server.policyUrl as PulseRoomRecord['server']['policyUrl'])
          : undefined,
    },
  };
};

const parseAtUri = (uri: string) => {
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

const isJetstreamCommitEvent = (value: unknown): value is JetstreamCommitEvent =>
  isRecord(value) &&
  value.kind === 'commit' &&
  typeof value.did === 'string' &&
  isRecord(value.commit);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const isRoomVisibility = (value: unknown): value is PulseRoomRecord['visibility'] =>
  value === 'public' || value === 'inviteOnlyListing';

const isRoomJoinMode = (value: unknown): value is PulseRoomRecord['joinMode'] =>
  value === 'open' || value === 'request' || value === 'invite';
