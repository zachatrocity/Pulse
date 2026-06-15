# Pulse

Pulse is a web-first, self-hosted voice product. The MVP is intentionally small: one React web app and one TypeScript API/server runtime, shipped from a single repository and one production container.

## MVP Architecture

- `apps/web` is the Vite React client. It owns browser UI, WebRTC call setup, and client-side state.
- `apps/api` is the Hono API/server runtime. It exposes health and API routes, indexes public Pulse AT Protocol room records into SQLite, validates runtime configuration, and serves the built web app in production.
- `packages/shared` holds client-safe contracts used by both the web app and API. Future mobile apps should consume this package or generated contracts instead of importing server internals.

Pulse uses AT Protocol for identity and discovery because users can bring portable handles, profiles, and social graph context without Pulse becoming the source of truth for identity. Pulse uses WebRTC for voice because real-time media should flow peer-to-peer where possible instead of being tunneled through the AT Protocol network. In short: AT Protocol helps people find and trust each other; WebRTC carries the voice.

Pulse room discovery records are defined as AT Protocol Lexicons in `packages/shared/src/lexicons`, with client-safe TypeScript contracts exported from `@pulse/shared`. See `docs/atproto/room-records.md` for the public record boundary, ownership model, indexing expectations, and compatibility rules.

The HTTP API contract lives in `docs/api.md`. It names the mobile-ready routes for identity, discovery, room policy, invites, and voice-token minting while documenting which browser OAuth routes are web-only today.

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

| Variable                      | Required         | Default                                                                                                          | Description                                                                                                                                                      |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | no               | `development`                                                                                                    | Runtime mode. Use `production` in the container.                                                                                                                 |
| `PULSE_HOST`                  | no               | `0.0.0.0`                                                                                                        | API bind host.                                                                                                                                                   |
| `PULSE_PORT`                  | no               | `8787`                                                                                                           | API port.                                                                                                                                                        |
| `PULSE_WEB_ORIGIN`            | no               | `http://localhost:5173`                                                                                          | Allowed browser origin for API calls.                                                                                                                            |
| `PULSE_PUBLIC_URL`            | production       | `http://127.0.0.1:8787`                                                                                          | Public API/web URL used for AT Protocol OAuth callbacks and client metadata. Use the reverse-proxied HTTPS URL in production.                                    |
| `PULSE_DATA_DIR`              | no               | `./data`                                                                                                         | Durable Pulse runtime data directory. Back this directory up.                                                                                                    |
| `PULSE_SESSION_SECRET`        | production       | development-only fallback                                                                                        | HMAC secret for the browser session cookie. Must be at least 32 characters in production.                                                                        |
| `PULSE_OAUTH_SCOPE`           | no               | `atproto repo:app.pulse.room repo:app.pulse.room.server repo:app.pulse.room.member repo:app.pulse.room.presence` | OAuth scopes requested from the user's PDS. Must include `atproto`; the repo scopes allow future Pulse room record writes.                                       |
| `PULSE_OAUTH_PRIVATE_KEY`     | production HTTPS | unset                                                                                                            | JSON private JWK for the confidential OAuth client. Generate with `npm run gen:oauth-key`. Required when `PULSE_PUBLIC_URL` is not local loopback in production. |
| `PULSE_DATABASE_PATH`         | no               | `./data/pulse.sqlite`                                                                                            | SQLite database path for the local room index.                                                                                                                   |
| `PULSE_ATPROTO_PDS_URL`       | no               | `https://bsky.social`                                                                                            | AT Protocol PDS used for startup backfill through `listRecords`.                                                                                                 |
| `PULSE_SERVER_DID`            | production       | `did:web:localhost`                                                                                              | DID for the Pulse server or service account embedded in published room records. Required in production.                                                          |
| `PULSE_INDEXER_REPOS`         | no               | empty                                                                                                            | Comma-separated DIDs to backfill on startup.                                                                                                                     |
| `PULSE_INDEXER_JETSTREAM_URL` | no               | empty                                                                                                            | Optional Jetstream WebSocket URL for ongoing room record create/update/delete events.                                                                            |

## AT Protocol Sign-In

Pulse uses the official TypeScript `@atproto/oauth-client-node` flow from the API runtime. The browser submits a handle to `/api/auth/atproto/login`, the API resolves the user's PDS and redirects through OAuth, then stores OAuth state and DID-keyed sessions under `PULSE_DATA_DIR`. The browser receives only a signed opaque `pulse_session` cookie.

For local development, `PULSE_PUBLIC_URL=http://127.0.0.1:8787` uses the AT Protocol loopback client path. For production, set `PULSE_PUBLIC_URL` to the HTTPS origin users visit and set `PULSE_OAUTH_PRIVATE_KEY` from:

```bash
npm run gen:oauth-key
```

## Room Discovery Index

Pulse indexes public `app.pulse.room` records inside the API runtime. On startup it backfills every DID listed in `PULSE_INDEXER_REPOS` with `com.atproto.repo.listRecords`, then keeps the local index current from `PULSE_INDEXER_JETSTREAM_URL` when a Jetstream source is configured.

Searchable public rooms are exposed at:

```bash
GET /api/rooms?q=audio&limit=50
```

Signed-in users can publish rooms through the web app or API. Pulse writes an
`app.pulse.room` record to the creator's AT Protocol repo and stores local
runtime state in SQLite for owner checks, voice state, and access policy:

```bash
POST /api/rooms
PATCH /api/rooms/:encodedRoomUri
```

The local index stores only public discovery metadata from Pulse room records. Deletes remove rooms from search, and updates replace the indexed record in place. Room API responses use DID-keyed `creator` and `server` principals; handles, display names, avatars, and PDS endpoints are returned only as mutable profile fields.

## Identity Cache

Pulse resolves AT Protocol identity in the API runtime and caches the client-safe profile snapshot in the same SQLite database as the room index. The cache key is always the DID. Handles are treated as refreshable display metadata because they can move to another DID.

The identity service:

- resolves handles with `com.atproto.identity.resolveHandle`,
- resolves PDS endpoints from DID documents,
- fetches public profile fields with `app.bsky.actor.getProfile`,
- refreshes stale cache entries after one hour,
- returns a DID-only principal when DID/profile lookup fails, so room discovery does not fail closed on a remote outage.

Clients can resolve a handle through:

```bash
GET /api/identity/resolve?handle=alice.bsky.social
```

This endpoint is for discovery and display. Store the returned DID for durable references, not the submitted handle.

## Deployment

The paved-road deployment is a single Docker image:

```bash
docker compose up -d --build
```

The container exposes port `8787` and serves both the API and built web UI. The `pulse-data` volume is required because AT Protocol OAuth state, refreshable sessions, signed web sessions, and the room index live under `/data`. Back up that volume before upgrades.

## Upgrade Notes

SQLite schema setup runs at API startup and is currently backward-compatible table creation only. Future schema changes should include:

- an explicit storage location,
- backup and restore instructions,
- migration commands,
- and compatibility notes for changed environment variables.
