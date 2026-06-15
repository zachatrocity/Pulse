import { Activity, LogOut, Radio, ShieldCheck, UserRound, Waves } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

import type { ApiError, AppInfo, AuthLoginResponse, AuthStatus } from '@pulse/shared';

const defaultInfo: AppInfo = {
  name: 'Pulse',
  version: '0.1.0',
  identity: 'atproto',
  media: 'webrtc',
};

export const App = () => {
  const [info, setInfo] = useState<AppInfo>(defaultInfo);
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false });
  const [handle, setHandle] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let ignore = false;

    fetch('/api/info')
      .then((response) => response.json() as Promise<AppInfo>)
      .then((payload) => {
        if (!ignore) {
          setInfo(payload);
        }
      })
      .catch(() => {
        if (!ignore) {
          setInfo(defaultInfo);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams(window.location.search);

    if (params.has('auth_error')) {
      setAuthError('AT Protocol sign-in did not complete. Try again from your handle.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    fetch('/api/auth/session', { credentials: 'include' })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then((payload) => {
        if (!ignore) {
          setAuth(payload);
        }
      })
      .catch(() => {
        if (!ignore) {
          setAuth({ authenticated: false });
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/atproto/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle }),
      });

      if (!response.ok) {
        const error = (await response.json()) as ApiError;
        throw new Error(error.error);
      }

      const payload = (await response.json()) as AuthLoginResponse;
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not start sign-in.');
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setAuth({ authenticated: false });
  };

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">Self-hosted voice rooms</p>
          <h1 id="hero-title">{info.name}</h1>
          <p className="lede">
            Portable identity from AT Protocol, direct voice over WebRTC, and a deployment shape
            small teams can run on one box.
          </p>
          <div className="actions" aria-label="Primary actions">
            {auth.authenticated ? (
              <div className="session-summary" aria-label="Signed in account">
                <UserRound aria-hidden="true" />
                <span>
                  Signed in as <strong>{auth.handle}</strong>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={signOut}
                  aria-label="Sign out"
                >
                  <LogOut aria-hidden="true" />
                </button>
              </div>
            ) : (
              <form className="login-form" onSubmit={signIn}>
                <label htmlFor="handle">AT Protocol handle</label>
                <div className="login-form__row">
                  <input
                    id="handle"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="alice.bsky.social"
                    autoComplete="username"
                    disabled={isSubmitting}
                  />
                  <button type="submit" className="button button--primary" disabled={isSubmitting}>
                    {isSubmitting ? 'Opening...' : 'Sign in'}
                  </button>
                </div>
                {authError ? <p className="form-error">{authError}</p> : null}
              </form>
            )}
            <a href="https://atproto.com" className="button button--secondary">
              AT Protocol
            </a>
          </div>
        </div>
        <div className="signal-panel" aria-label="Pulse runtime model">
          <div className="signal-panel__header">
            <Waves aria-hidden="true" />
            <span>Room signal</span>
          </div>
          <div className="signal-grid">
            <span>Identity</span>
            <strong>{info.identity}</strong>
            <span>Media</span>
            <strong>{info.media}</strong>
            <span>Version</span>
            <strong>{info.version}</strong>
            <span>Session</span>
            <strong>{auth.authenticated ? 'active' : 'none'}</strong>
          </div>
        </div>
      </section>

      <section className="features" aria-label="Architecture pillars">
        <article>
          <ShieldCheck aria-hidden="true" />
          <h2>Bring your identity</h2>
          <p>Use AT Protocol handles and profiles for discovery without making Pulse own users.</p>
        </article>
        <article>
          <Radio aria-hidden="true" />
          <h2>Speak directly</h2>
          <p>Keep real-time voice on WebRTC so media does not ride through the identity network.</p>
        </article>
        <article>
          <Activity aria-hidden="true" />
          <h2>Operate simply</h2>
          <p>
            One API runtime serves the built web app and exposes health checks for reverse proxies.
          </p>
        </article>
      </section>
    </main>
  );
};
