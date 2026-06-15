import { getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Hono } from 'hono';

import {
  apiErrorSchema,
  authLoginRequestSchema,
  authLoginResponseSchema,
  authStatusSchema,
} from '@pulse/shared';

import type { RuntimeConfig } from '../config.js';
import {
  createSessionId,
  sessionCookieName,
  signSessionId,
  verifySignedSessionId,
} from './cookies.js';
import { createOAuthClient, getOAuthClientMetadata, getPublicJwks } from './oauth.js';
import type { FileAuthStore, WebSessionRecord } from './store.js';

type AuthDependencies = {
  config: RuntimeConfig;
  store: FileAuthStore;
};

const cookieOptions = (config: RuntimeConfig) => ({
  httpOnly: true,
  secure: config.publicUrl.startsWith('https://'),
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
});

const clearCookieOptions = (config: RuntimeConfig) => ({
  ...cookieOptions(config),
  maxAge: 0,
});

const jsonError = (message: string) => apiErrorSchema.parse({ error: message });

const normalizeHandle = (handle: string): string =>
  handle.trim().replace(/^@/, '').toLocaleLowerCase();

export const getCurrentWebSession = async ({
  config,
  store,
  cookie,
}: AuthDependencies & { cookie: string | undefined }): Promise<{
  sessionId: string;
  session: WebSessionRecord;
} | null> => {
  const sessionId = verifySignedSessionId(cookie, config.sessionSecret);
  if (!sessionId) {
    return null;
  }

  const session = await store.getWebSession(sessionId);
  return session ? { sessionId, session } : null;
};

export const registerAuthRoutes = (app: Hono, { config, store }: AuthDependencies) => {
  app.get('/oauth-client-metadata.json', (c) => c.json(getOAuthClientMetadata(config)));

  app.get('/.well-known/jwks.json', async (c) => c.json(await getPublicJwks(config)));

  app.post('/api/auth/atproto/login', async (c) => {
    const payload = authLoginRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!payload.success) {
      return c.json(jsonError('Enter a valid AT Protocol handle.'), 400);
    }

    try {
      const handle = normalizeHandle(payload.data.handle);
      const oauthClient = await createOAuthClient(config, store);
      const authorizationUrl = await oauthClient.authorize(handle, {
        scope: config.oauthScope,
        state: JSON.stringify({ handle }),
      });

      return c.json(
        authLoginResponseSchema.parse({ authorizationUrl: authorizationUrl.toString() }),
      );
    } catch (error) {
      console.error('AT Protocol OAuth login failed', error);
      return c.json(
        jsonError('Could not start AT Protocol sign-in. Check the handle and try again.'),
        400,
      );
    }
  });

  app.get('/api/auth/atproto/callback', async (c) => {
    try {
      const oauthClient = await createOAuthClient(config, store);
      const callbackUrl = new URL(c.req.url);
      const { session, state } = await oauthClient.callback(callbackUrl.searchParams);
      const tokenInfo = await session.getTokenInfo();
      const parsedState = state ? JSON.parse(state) : {};
      const handle = typeof parsedState.handle === 'string' ? parsedState.handle : session.did;
      const now = new Date().toISOString();
      const webSession: WebSessionRecord = {
        did: session.did,
        handle,
        pdsEndpoint: tokenInfo.aud,
        scope: tokenInfo.scope,
        tokenExpiresAt: tokenInfo.expiresAt?.toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      const sessionId = createSessionId();

      await store.setWebSession(sessionId, webSession);
      setCookie(
        c,
        sessionCookieName,
        signSessionId(sessionId, config.sessionSecret),
        cookieOptions(config),
      );

      return c.redirect(`${config.webOrigin}/`);
    } catch (error) {
      console.error('AT Protocol OAuth callback failed', error);
      return c.redirect(`${config.webOrigin}/?auth_error=oauth_callback_failed`);
    }
  });

  app.get('/api/auth/session', async (c) => {
    const current = await getCurrentWebSession({
      config,
      store,
      cookie: getCookie(c, sessionCookieName),
    });

    if (!current) {
      return c.json(authStatusSchema.parse({ authenticated: false }));
    }

    try {
      const oauthClient = await createOAuthClient(config, store);
      const oauthSession = await oauthClient.restore(current.session.did);
      const tokenInfo = await oauthSession.getTokenInfo();
      const updated: WebSessionRecord = {
        ...current.session,
        pdsEndpoint: tokenInfo.aud,
        scope: tokenInfo.scope,
        tokenExpiresAt: tokenInfo.expiresAt?.toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await store.setWebSession(current.sessionId, updated);

      return c.json(
        authStatusSchema.parse({
          authenticated: true,
          did: updated.did,
          handle: updated.handle,
          pdsEndpoint: updated.pdsEndpoint,
          scope: updated.scope,
          tokenExpiresAt: updated.tokenExpiresAt,
        }),
      );
    } catch (error) {
      console.error('AT Protocol session restore failed', error);
      await store.deleteWebSession(current.sessionId);
      setCookie(c, sessionCookieName, '', clearCookieOptions(config));
      return c.json(authStatusSchema.parse({ authenticated: false }));
    }
  });

  app.post('/api/auth/logout', async (c) => {
    const current = await getCurrentWebSession({
      config,
      store,
      cookie: getCookie(c, sessionCookieName),
    });

    if (current) {
      await store.deleteWebSession(current.sessionId);
      try {
        const oauthClient = await createOAuthClient(config, store);
        await oauthClient.revoke(current.session.did);
      } catch (error) {
        console.error('AT Protocol OAuth revoke failed', error);
      }
    }

    setCookie(c, sessionCookieName, '', clearCookieOptions(config));
    return c.json(authStatusSchema.parse({ authenticated: false }));
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json(jsonError(error.message), error.status);
    }

    console.error(error);
    return c.json(jsonError('Unexpected server error.'), 500);
  });
};
