export type RuntimeConfig = {
  host: string;
  port: number;
  publicUrl: string;
  webOrigin: string;
  nodeEnv: string;
  dataDir: string;
  sessionSecret: string;
  oauthPrivateKey?: string;
  oauthScope: string;
};

const DEFAULT_OAUTH_SCOPE =
  'atproto repo:app.pulse.room repo:app.pulse.room.server repo:app.pulse.room.member repo:app.pulse.room.presence';

const parsePort = (value: string | undefined): number => {
  const fallback = 8787;
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PULSE_PORT must be a valid TCP port, received "${value}"`);
  }

  return parsed;
};

const normalizeUrl = (value: string, name: string): string => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error();
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL, received "${value}"`);
  }
};

const validateSecret = (value: string | undefined, nodeEnv: string): string => {
  if (value && value.length >= 32) {
    return value;
  }

  if (nodeEnv === 'production') {
    throw new Error('PULSE_SESSION_SECRET must be set to at least 32 characters in production');
  }

  return 'development-only-pulse-session-secret';
};

const validateScope = (value: string | undefined): string => {
  const scope = value?.trim() || DEFAULT_OAUTH_SCOPE;
  const scopes = new Set(scope.split(/\s+/));

  if (!scopes.has('atproto')) {
    throw new Error('PULSE_OAUTH_SCOPE must include the required "atproto" scope');
  }

  return [...scopes].join(' ');
};

const isLoopbackUrl = (value: string): boolean => {
  const url = new URL(value);
  return url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
};

const validatePrivateKey = (
  value: string | undefined,
  publicUrl: string,
  nodeEnv: string,
): string | undefined => {
  if (isLoopbackUrl(publicUrl)) {
    return value;
  }

  if (!value && nodeEnv === 'production') {
    throw new Error('PULSE_OAUTH_PRIVATE_KEY is required for production OAuth clients');
  }

  if (!value) {
    return undefined;
  }

  try {
    JSON.parse(value);
  } catch {
    throw new Error('PULSE_OAUTH_PRIVATE_KEY must be a JSON JWK private key');
  }

  return value;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): RuntimeConfig => {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = parsePort(env.PULSE_PORT);
  const publicUrl = normalizeUrl(
    env.PULSE_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
    'PULSE_PUBLIC_URL',
  );

  return {
    host: env.PULSE_HOST ?? '0.0.0.0',
    port,
    publicUrl,
    webOrigin: normalizeUrl(env.PULSE_WEB_ORIGIN ?? 'http://localhost:5173', 'PULSE_WEB_ORIGIN'),
    nodeEnv,
    dataDir: env.PULSE_DATA_DIR ?? './data',
    sessionSecret: validateSecret(env.PULSE_SESSION_SECRET, nodeEnv),
    oauthPrivateKey: validatePrivateKey(env.PULSE_OAUTH_PRIVATE_KEY, publicUrl, nodeEnv),
    oauthScope: validateScope(env.PULSE_OAUTH_SCOPE),
  };
};
