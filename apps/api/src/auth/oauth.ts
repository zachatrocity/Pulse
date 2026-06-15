import {
  JoseKey,
  Keyset,
  NodeOAuthClient,
  buildAtprotoLoopbackClientMetadata,
} from '@atproto/oauth-client-node';
import type { OAuthClientMetadataInput } from '@atproto/oauth-client-node';

import type { RuntimeConfig } from '../config.js';
import type { FileAuthStore } from './store.js';

const callbackPath = '/api/auth/atproto/callback';
const metadataPath = '/oauth-client-metadata.json';
const jwksPath = '/.well-known/jwks.json';

export const getOAuthRedirectUri = (config: RuntimeConfig): string =>
  `${config.publicUrl}${callbackPath}`;

export const getOAuthClientMetadata = (config: RuntimeConfig): OAuthClientMetadataInput => {
  if (config.publicUrl.startsWith('http://127.0.0.1')) {
    return buildAtprotoLoopbackClientMetadata({
      scope: config.oauthScope,
      redirect_uris: [getOAuthRedirectUri(config)],
    });
  }

  return {
    client_id: `${config.publicUrl}${metadataPath}`,
    client_name: 'Pulse',
    client_uri: config.publicUrl,
    redirect_uris: [getOAuthRedirectUri(config)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: config.oauthScope,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    jwks_uri: `${config.publicUrl}${jwksPath}`,
    dpop_bound_access_tokens: true,
  };
};

const getKeyset = async (config: RuntimeConfig): Promise<Keyset | undefined> => {
  if (!config.oauthPrivateKey) {
    return undefined;
  }

  return new Keyset([await JoseKey.fromJWK(JSON.parse(config.oauthPrivateKey))]);
};

export const createOAuthClient = async (
  config: RuntimeConfig,
  store: FileAuthStore,
): Promise<NodeOAuthClient> =>
  new NodeOAuthClient({
    clientMetadata: getOAuthClientMetadata(config),
    keyset: await getKeyset(config),
    stateStore: store.stateStore,
    sessionStore: store.sessionStore,
    allowHttp: config.publicUrl.startsWith('http://127.0.0.1'),
  });

export const getPublicJwks = async (config: RuntimeConfig) => {
  if (!config.oauthPrivateKey) {
    return { keys: [] };
  }

  const key = await JoseKey.fromJWK(JSON.parse(config.oauthPrivateKey));
  return { keys: [key.publicJwk] };
};
