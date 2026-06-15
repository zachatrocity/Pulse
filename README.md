# Pulse

Pulse is a web-first, self-hosted voice product. The MVP is intentionally small: one React web app and one TypeScript API/server runtime, shipped from a single repository and one production container.

## MVP Architecture

- `apps/web` is the Vite React client. It owns browser UI, WebRTC call setup, and client-side state.
- `apps/api` is the Hono API/server runtime. It exposes health and API routes, validates runtime configuration, and serves the built web app in production.
- `packages/shared` holds client-safe contracts used by both the web app and API. Future mobile apps should consume this package or generated contracts instead of importing server internals.

Pulse uses AT Protocol for identity and discovery because users can bring portable handles, profiles, and social graph context without Pulse becoming the source of truth for identity. Pulse uses WebRTC for voice because real-time media should flow peer-to-peer where possible instead of being tunneled through the AT Protocol network. In short: AT Protocol helps people find and trust each other; WebRTC carries the voice.

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

| Variable           | Required | Default                 | Description                                      |
| ------------------ | -------- | ----------------------- | ------------------------------------------------ |
| `NODE_ENV`         | no       | `development`           | Runtime mode. Use `production` in the container. |
| `PULSE_HOST`       | no       | `0.0.0.0`               | API bind host.                                   |
| `PULSE_PORT`       | no       | `8787`                  | API port.                                        |
| `PULSE_WEB_ORIGIN` | no       | `http://localhost:5173` | Allowed browser origin for API calls.            |

## Deployment

The paved-road deployment is a single Docker image:

```bash
docker compose up -d --build
```

The container exposes port `8787` and serves both the API and built web UI. There is no required persistent volume yet because the MVP scaffold does not store durable user data. When rooms, accounts, recordings, uploads, or settings become durable, the storage path and backup target must be documented before release.

## Upgrade Notes

This scaffold has no migrations. Future changes that add durable data should include:

- an explicit storage location,
- backup and restore instructions,
- migration commands,
- and compatibility notes for changed environment variables.
