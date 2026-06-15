import { pulseLexiconIds } from '@pulse/shared';

import type { AtUri, Cid, Did, PulseRoomRecord } from '@pulse/shared';

export type AtprotoRepoSession = {
  did: Did;
  fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
};

export type PublishedRoomRecord = {
  uri: AtUri;
  cid: Cid;
  rkey: string;
  record: PulseRoomRecord;
};

export interface RoomRecordPublisher {
  createRoomRecord(
    session: AtprotoRepoSession,
    record: PulseRoomRecord,
  ): Promise<PublishedRoomRecord>;
  updateRoomRecord(
    session: AtprotoRepoSession,
    input: {
      repo: Did;
      rkey: string;
      record: PulseRoomRecord;
    },
  ): Promise<PublishedRoomRecord>;
}

type RepoWriteResponse = {
  uri: AtUri;
  cid: Cid;
};

export class OAuthRoomRecordPublisher implements RoomRecordPublisher {
  async createRoomRecord(
    session: AtprotoRepoSession,
    record: PulseRoomRecord,
  ): Promise<PublishedRoomRecord> {
    const payload = await writeRepoRecord(session, '/xrpc/com.atproto.repo.createRecord', {
      repo: session.did,
      collection: pulseLexiconIds.room,
      record,
    });
    const rkey = parsePublishedRoomUri(payload.uri)?.rkey;
    if (!rkey) {
      throw new Error(`PDS returned an invalid Pulse room URI: ${payload.uri}`);
    }

    return { ...payload, rkey, record };
  }

  async updateRoomRecord(
    session: AtprotoRepoSession,
    input: {
      repo: Did;
      rkey: string;
      record: PulseRoomRecord;
    },
  ): Promise<PublishedRoomRecord> {
    const payload = await writeRepoRecord(session, '/xrpc/com.atproto.repo.putRecord', {
      repo: input.repo,
      collection: pulseLexiconIds.room,
      rkey: input.rkey,
      record: input.record,
    });

    return { ...payload, rkey: input.rkey, record: input.record };
  }
}

const writeRepoRecord = async (
  session: AtprotoRepoSession,
  pathname: string,
  body: Record<string, unknown>,
): Promise<RepoWriteResponse> => {
  const response = await session.fetchHandler(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`PDS repo write failed: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as Partial<RepoWriteResponse>;
  if (!payload.uri || !payload.cid) {
    throw new Error('PDS repo write response did not include uri and cid');
  }

  return { uri: payload.uri, cid: payload.cid };
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
