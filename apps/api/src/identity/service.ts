import { DatabaseSync } from 'node:sqlite';

import type { Did, IdentityPrincipal } from '@pulse/shared';

export type IdentityCacheRecord = IdentityPrincipal & {
  refreshedAt: string;
  failedAt?: string;
};

type DidDocument = {
  service?: Array<{
    id?: string;
    type?: string;
    serviceEndpoint?: string | string[];
  }>;
};

type FetchLike = typeof fetch;

type IdentityServiceOptions = {
  fetch?: FetchLike;
  now?: () => Date;
  profileTtlMs?: number;
  plcDirectoryUrl?: string;
};

type ResolveHandleResponse = {
  did?: string;
};

type ProfileResponse = {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
};

const defaultProfileTtlMs = 60 * 60 * 1000;

export class IdentityCacheStore {
  constructor(readonly database: DatabaseSync) {
    this.migrate();
  }

  get(did: Did): IdentityCacheRecord | undefined {
    const row = this.database.prepare('SELECT * FROM identity_cache WHERE did = ?').get(did) as
      | {
          did: string;
          handle: string | null;
          display_name: string | null;
          avatar_url: string | null;
          pds_endpoint: string | null;
          profile_updated_at: string | null;
          refreshed_at: string;
          failed_at: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      did: row.did as Did,
      handle: row.handle ?? undefined,
      displayName: row.display_name ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      pdsEndpoint: row.pds_endpoint ?? undefined,
      profileUpdatedAt: row.profile_updated_at ?? undefined,
      refreshedAt: row.refreshed_at,
      failedAt: row.failed_at ?? undefined,
    };
  }

  upsert(record: IdentityCacheRecord) {
    this.database
      .prepare(
        `
          INSERT INTO identity_cache (
            did, handle, display_name, avatar_url, pds_endpoint,
            profile_updated_at, refreshed_at, failed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(did) DO UPDATE SET
            handle = excluded.handle,
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url,
            pds_endpoint = excluded.pds_endpoint,
            profile_updated_at = excluded.profile_updated_at,
            refreshed_at = excluded.refreshed_at,
            failed_at = excluded.failed_at
        `,
      )
      .run(
        record.did,
        record.handle ?? null,
        record.displayName ?? null,
        record.avatarUrl ?? null,
        record.pdsEndpoint ?? null,
        record.profileUpdatedAt ?? null,
        record.refreshedAt,
        record.failedAt ?? null,
      );
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS identity_cache (
        did TEXT PRIMARY KEY,
        handle TEXT,
        display_name TEXT,
        avatar_url TEXT,
        pds_endpoint TEXT,
        profile_updated_at TEXT,
        refreshed_at TEXT NOT NULL,
        failed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS identity_cache_handle_idx ON identity_cache(handle);
      CREATE INDEX IF NOT EXISTS identity_cache_refreshed_at_idx ON identity_cache(refreshed_at);
    `);
  }
}

export class AtprotoIdentityService {
  private readonly fetch: FetchLike;
  private readonly now: () => Date;
  private readonly profileTtlMs: number;
  private readonly plcDirectoryUrl: string;

  constructor(
    private readonly store: IdentityCacheStore,
    private readonly defaultPdsUrl: string,
    options: IdentityServiceOptions = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.profileTtlMs = options.profileTtlMs ?? defaultProfileTtlMs;
    this.plcDirectoryUrl = options.plcDirectoryUrl ?? 'https://plc.directory';
  }

  async resolveHandle(handle: string): Promise<IdentityPrincipal | null> {
    const normalized = normalizeHandle(handle);
    if (!normalized) {
      return null;
    }

    const url = new URL('/xrpc/com.atproto.identity.resolveHandle', this.defaultPdsUrl);
    url.searchParams.set('handle', normalized);

    try {
      const response = await this.fetch(url);
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as ResolveHandleResponse;
      if (!payload.did || !isDid(payload.did)) {
        return null;
      }

      return this.refreshPrincipal(payload.did as Did, { handle: normalized });
    } catch {
      return null;
    }
  }

  async getPrincipal(did: Did): Promise<IdentityPrincipal> {
    const cached = this.store.get(did);
    if (cached && !this.isStale(cached.refreshedAt)) {
      return toPrincipal(cached);
    }

    return this.refreshPrincipal(did);
  }

  async getPrincipals(dids: Did[]): Promise<Map<Did, IdentityPrincipal>> {
    const uniqueDids = [...new Set(dids)];
    const entries = await Promise.all(
      uniqueDids.map(async (did) => [did, await this.getPrincipal(did)]),
    );
    return new Map(entries as Array<[Did, IdentityPrincipal]>);
  }

  async refreshPrincipal(
    did: Did,
    hints: Partial<IdentityPrincipal> = {},
  ): Promise<IdentityPrincipal> {
    const cached = this.store.get(did);
    const now = this.now().toISOString();

    try {
      const didDocument = await this.resolveDidDocument(did);
      const pdsEndpoint = getPdsEndpoint(didDocument) ?? hints.pdsEndpoint ?? cached?.pdsEndpoint;
      const profile = await this.fetchProfile(did, pdsEndpoint);
      const record: IdentityCacheRecord = {
        did,
        handle: profile?.handle ?? hints.handle ?? cached?.handle,
        displayName: profile?.displayName ?? hints.displayName ?? cached?.displayName,
        avatarUrl: profile?.avatar ?? hints.avatarUrl ?? cached?.avatarUrl,
        pdsEndpoint,
        profileUpdatedAt: profile ? now : cached?.profileUpdatedAt,
        refreshedAt: now,
      };

      this.store.upsert(record);
      return toPrincipal(record);
    } catch {
      const fallback: IdentityCacheRecord = {
        did,
        handle: hints.handle ?? cached?.handle,
        displayName: hints.displayName ?? cached?.displayName,
        avatarUrl: hints.avatarUrl ?? cached?.avatarUrl,
        pdsEndpoint: hints.pdsEndpoint ?? cached?.pdsEndpoint,
        profileUpdatedAt: cached?.profileUpdatedAt,
        refreshedAt: now,
        failedAt: now,
      };

      this.store.upsert(fallback);
      return toPrincipal(fallback);
    }
  }

  private isStale(refreshedAt: string): boolean {
    const refreshed = Date.parse(refreshedAt);
    return Number.isNaN(refreshed) || this.now().getTime() - refreshed > this.profileTtlMs;
  }

  private async resolveDidDocument(did: Did): Promise<DidDocument> {
    const url = getDidDocumentUrl(did, this.plcDirectoryUrl);
    const response = await this.fetch(url);
    if (!response.ok) {
      throw new Error(`DID resolution failed for ${did}: ${response.status}`);
    }

    return (await response.json()) as DidDocument;
  }

  private async fetchProfile(
    did: Did,
    pdsEndpoint: string | undefined,
  ): Promise<ProfileResponse | null> {
    const baseUrl = pdsEndpoint ?? this.defaultPdsUrl;
    const url = new URL('/xrpc/app.bsky.actor.getProfile', baseUrl);
    url.searchParams.set('actor', did);

    const response = await this.fetch(url);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ProfileResponse;
    return payload.did === did ? payload : null;
  }
}

const normalizeHandle = (handle: string): string =>
  handle.trim().replace(/^@/, '').toLocaleLowerCase();

const isDid = (value: string): value is Did => value.startsWith('did:');

const getDidDocumentUrl = (did: Did, plcDirectoryUrl: string): URL => {
  if (did.startsWith('did:plc:')) {
    return new URL(`/${did}`, plcDirectoryUrl);
  }

  if (did.startsWith('did:web:')) {
    const identifier = did.slice('did:web:'.length);
    const [host, ...pathParts] = identifier.split(':').map(decodeURIComponent);
    const path = pathParts.length ? `/${pathParts.join('/')}/did.json` : '/.well-known/did.json';
    return new URL(`https://${host}${path}`);
  }

  throw new Error(`Unsupported DID method for ${did}`);
};

const getPdsEndpoint = (document: DidDocument): string | undefined => {
  const service = document.service?.find(
    (entry) => entry.id === '#atproto_pds' || entry.type === 'AtprotoPersonalDataServer',
  );
  const endpoint = Array.isArray(service?.serviceEndpoint)
    ? service?.serviceEndpoint[0]
    : service?.serviceEndpoint;

  if (!endpoint) {
    return undefined;
  }

  try {
    return new URL(endpoint).toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

const toPrincipal = (record: IdentityCacheRecord): IdentityPrincipal => ({
  did: record.did,
  handle: record.handle,
  displayName: record.displayName,
  avatarUrl: record.avatarUrl,
  pdsEndpoint: record.pdsEndpoint,
  profileUpdatedAt: record.profileUpdatedAt,
});
