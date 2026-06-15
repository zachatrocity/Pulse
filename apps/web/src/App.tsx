import { Activity, Radio, ShieldCheck, Waves } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AppInfo } from '@pulse/shared';

const defaultInfo: AppInfo = {
  name: 'Pulse',
  version: '0.1.0',
  identity: 'atproto',
  media: 'webrtc',
};

export const App = () => {
  const [info, setInfo] = useState<AppInfo>(defaultInfo);

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
            <a href="/api/info" className="button button--primary">
              API status
            </a>
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
