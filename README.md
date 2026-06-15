# Pulse

Pulse is a web-first, self-hosted voice product. The MVP is intentionally small: one React web app and one TypeScript API/server runtime, shipped from a single repository and one production container.

## MVP Architecture

- `apps/web` is the Vite React client. It owns browser UI, WebRTC call setup, and client-side state.
- `apps/api` is the Hono API/server runtime. It exposes health and API routes, validates runtime configuration, and serves the built web app in production.
- `packages/shared` holds client-safe contracts used by both the web app and API. Future mobile apps should consume this package or generated contracts instead of importing server internals.

Pulse uses AT Protocol for identity and discovery because users can bring portable handles, profiles, and social graph context without Pulse becoming the source of truth for identity. Pulse uses WebRTC for voice because real-time media should flow peer-to-peer where possible instead of being tunneled through the AT Protocol network. In short: AT Protocol helps people find and trust each other; WebRTC carries the voice.

Pulse room discovery records are defined as AT Protocol Lexicons in `packages/shared/src/lexicons`, with client-safe TypeScript contracts exported from `@pulse/shared`. See `docs/atproto/room-records.md` for the public record boundary, ownership model, indexing expectations, and compatibility rules.

## Tool Versions

- Node.js `22.x` or newer. The repo includes `.nvmrc`.
- npm `10.x` or newer. Commit and use `package-lock.json`.

## Local Development

```bash
npm install
npm run dev
```

That starts:

- API: `http://localhost:8787`
- Web: `http://localhost:5173`

The web app proxies `/api` and `/healthz` to the API during development.

## Common Commands

```bash
npm run build
npm run test
npm run lint
npm run format
npm run format:check
npm run typecheck
```

## Configuration

Copy `.env.example` to `.env` for local overrides.

| Variable                  | Required         | Default                                                                                                          | Description                                                                                                                                                      |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | no               | `development`                                                                                                    | Runtime mode. Use `production` in the container.                                                                                                                 |
| `PULSE_HOST`              | no               | `0.0.0.0`                                                                                                        | API bind host.                                                                                                                                                   |
| `PULSE_PORT`              | no               | `8787`                                                                                                           | API port.                                                                                                                                                        |
| `PULSE_WEB_ORIGIN`        | no               | `http://localhost:5173`                                                                                          | Allowed browser origin for API calls.                                                                                                                            |
| `PULSE_PUBLIC_URL`        | production       | `http://127.0.0.1:8787`                                                                                          | Public API/web URL used for AT Protocol OAuth callbacks and client metadata. Use the reverse-proxied HTTPS URL in production.                                    |
| `PULSE_DATA_DIR`          | no               | `./data`                                                                                                         | Durable auth/session store path. Back this directory up.                                                                                                         |
| `PULSE_SESSION_SECRET`    | production       | development-only fallback                                                                                        | HMAC secret for the browser session cookie. Must be at least 32 characters in production.                                                                        |
| `PULSE_OAUTH_SCOPE`       | no               | `atproto repo:app.pulse.room repo:app.pulse.room.server repo:app.pulse.room.member repo:app.pulse.room.presence` | OAuth scopes requested from the user's PDS. Must include `atproto`; the repo scopes allow future Pulse room record writes.                                       |
| `PULSE_OAUTH_PRIVATE_KEY` | production HTTPS | unset                                                                                                            | JSON private JWK for the confidential OAuth client. Generate with `npm run gen:oauth-key`. Required when `PULSE_PUBLIC_URL` is not local loopback in production. |

## AT Protocol Sign-In

Pulse uses the official TypeScript `@atproto/oauth-client-node` flow from the API runtime. The browser submits a handle to `/api/auth/atproto/login`, the API resolves the user's PDS and redirects through OAuth, then stores OAuth state and DID-keyed sessions under `PULSE_DATA_DIR`. The browser receives only a signed opaque `pulse_session` cookie.

For local development, `PULSE_PUBLIC_URL=http://127.0.0.1:8787` uses the AT Protocol loopback client path. For production, set `PULSE_PUBLIC_URL` to the HTTPS origin users visit and set `PULSE_OAUTH_PRIVATE_KEY` from:

```bash
npm run gen:oauth-key
```

## Deployment

The paved-road deployment is a single Docker image:

```bash
docker compose up -d --build
```

The container exposes port `8787` and serves both the API and built web UI. The `pulse-data` volume is required because AT Protocol OAuth state, refreshable sessions, and signed web sessions live in `/data/auth-store.json`. Back up that volume before upgrades.

## Upgrade Notes

This scaffold has no migrations yet. Future changes that add durable room data should include:

- an explicit storage location,
- backup and restore instructions,
- migration commands,
- and compatibility notes for changed environment variables.
