export type RuntimeConfig = {
  host: string;
  port: number;
  webOrigin: string;
  nodeEnv: string;
};

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

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): RuntimeConfig => ({
  host: env.PULSE_HOST ?? '0.0.0.0',
  port: parsePort(env.PULSE_PORT),
  webOrigin: env.PULSE_WEB_ORIGIN ?? 'http://localhost:5173',
  nodeEnv: env.NODE_ENV ?? 'development',
});
