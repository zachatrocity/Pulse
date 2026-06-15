import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'pulse_session';

export const sessionCookieName = SESSION_COOKIE;

export const createSessionId = (): string => randomBytes(32).toString('base64url');

export const signSessionId = (sessionId: string, secret: string): string => {
  const signature = createHmac('sha256', secret).update(sessionId).digest('base64url');
  return `${sessionId}.${signature}`;
};

export const verifySignedSessionId = (value: string | undefined, secret: string): string | null => {
  if (!value) {
    return null;
  }

  const [sessionId, signature] = value.split('.');
  if (!sessionId || !signature) {
    return null;
  }

  const expected = createHmac('sha256', secret).update(sessionId).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer) ? sessionId : null;
};
