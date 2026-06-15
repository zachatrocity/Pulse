import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { NodeSavedSession, NodeSavedState } from '@atproto/oauth-client-node';

export type WebSessionRecord = {
  did: string;
  handle: string;
  pdsEndpoint: string;
  scope: string;
  tokenExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

type AuthStoreData = {
  oauthState: Record<string, NodeSavedState>;
  oauthSessions: Record<string, NodeSavedSession>;
  webSessions: Record<string, WebSessionRecord>;
};

const emptyData = (): AuthStoreData => ({
  oauthState: {},
  oauthSessions: {},
  webSessions: {},
});

export class FileAuthStore {
  private data: AuthStoreData | undefined;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static fromDataDir(dataDir: string): FileAuthStore {
    return new FileAuthStore(join(dataDir, 'auth-store.json'));
  }

  stateStore = {
    get: async (key: string): Promise<NodeSavedState | undefined> => {
      const data = await this.read();
      return data.oauthState[key];
    },
    set: async (key: string, value: NodeSavedState): Promise<void> => {
      const data = await this.read();
      data.oauthState[key] = value;
      await this.write(data);
    },
    del: async (key: string): Promise<void> => {
      const data = await this.read();
      delete data.oauthState[key];
      await this.write(data);
    },
  };

  sessionStore = {
    get: async (key: string): Promise<NodeSavedSession | undefined> => {
      const data = await this.read();
      return data.oauthSessions[key];
    },
    set: async (key: string, value: NodeSavedSession): Promise<void> => {
      const data = await this.read();
      data.oauthSessions[key] = value;
      await this.write(data);
    },
    del: async (key: string): Promise<void> => {
      const data = await this.read();
      delete data.oauthSessions[key];
      await this.write(data);
    },
  };

  async getWebSession(id: string): Promise<WebSessionRecord | undefined> {
    const data = await this.read();
    return data.webSessions[id];
  }

  async setWebSession(id: string, value: WebSessionRecord): Promise<void> {
    const data = await this.read();
    data.webSessions[id] = value;
    await this.write(data);
  }

  async deleteWebSession(id: string): Promise<void> {
    const data = await this.read();
    delete data.webSessions[id];
    await this.write(data);
  }

  private async read(): Promise<AuthStoreData> {
    if (this.data) {
      return this.data;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.data = { ...emptyData(), ...JSON.parse(raw) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        this.data = emptyData();
      } else {
        throw error;
      }
    }

    if (!this.data) {
      throw new Error('Auth store failed to initialize');
    }

    return this.data;
  }

  private async write(data: AuthStoreData): Promise<void> {
    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(tempPath, this.filePath);
    });

    await this.pendingWrite;
  }
}
