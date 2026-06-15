# Pulse API Contract

Pulse has one API runtime for the web MVP and future mobile clients. Do not add a
second backend for mobile. New clients should consume the schemas exported from
`@pulse/shared`; API tests in `apps/api/src/app.test.ts` assert the implemented
response shapes below.

## Client Classes

| Class            | Status        | Auth transport                         | Notes                                                                                                           |
| ---------------- | ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Web app          | supported now | `pulse_session` HTTP-only cookie       | Browser OAuth callback and logout are web-only because they redirect through the browser.                       |
| Mobile app       | contract only | future `Authorization: Bearer <token>` | Mobile should reuse discovery, identity, policy, invite, and voice-token routes once token auth is implemented. |
| Public discovery | supported now | none                                   | Public and invite-listed room metadata is readable without a session.                                           |

## Common Rules

- All request and response bodies are JSON unless the endpoint is an OAuth redirect.
- Error responses use `{ "error": string }`.
- Room URI path parameters must be URL-encoded AT URIs, for example
  `/api/rooms/at%3A%2F%2Fdid%3Aplc%3Acreator%2Fapp.pulse.room%2Froom1`.
- Browser cookie auth is the only implemented session transport today. Mobile
  bearer auth is reserved by this contract and should validate to the same
  identity shape as `GET /api/identity/me`.

## Health and Info

### `GET /healthz`

Public readiness check for the API process.

Response:

```json
{
  "ok": true,
  "service": "pulse-api",
  "version": "0.1.0"
}
```

### `GET /api/info`

Client-safe application metadata.

Response:

```json
{
  "name": "Pulse",
  "version": "0.1.0",
  "identity": "atproto",
  "media": "webrtc"
}
```

## Auth and Identity

### `POST /api/auth/atproto/login`

Web-only browser OAuth start. Mobile clients should not depend on this redirect
flow.

Request:

```json
{
  "handle": "alice.bsky.social"
}
```

Response:

```json
{
  "authorizationUrl": "https://..."
}
```

### `GET /api/auth/atproto/callback`

Web-only OAuth callback. On success the API stores the AT Protocol OAuth session
server-side, sets the signed opaque `pulse_session` cookie, and redirects to the
configured web origin.

### `GET /api/auth/session`

Web session state backed by the browser cookie.

Anonymous response:

```json
{
  "authenticated": false
}
```

Authenticated response:

```json
{
  "authenticated": true,
  "did": "did:plc:example",
  "handle": "alice.bsky.social",
  "pdsEndpoint": "https://bsky.social",
  "scope": "atproto repo:app.pulse.room",
  "tokenExpiresAt": "2026-06-15T00:00:00.000Z"
}
```

### `POST /api/auth/logout`

Web-only logout. Deletes the server-side web session, attempts to revoke the AT
Protocol OAuth session, clears the cookie, and returns anonymous session state.

### `GET /api/identity/me`

Mobile-ready identity endpoint. It returns the same discriminated identity shape
as `GET /api/auth/session`, but the route name is not tied to browser cookies.
Today it returns anonymous state until bearer-token auth is implemented.

## Discovery

### `GET /api/discovery/rooms?q=&limit=`

Mobile-ready room discovery endpoint. This is the preferred client contract for
new web and mobile room lists.

### `GET /api/rooms?q=&limit=`

Existing web-compatible alias for room discovery. Keep it compatible with
`/api/discovery/rooms`.

Response:

```json
{
  "rooms": [
    {
      "uri": "at://did:plc:creator/app.pulse.room/room1",
      "cid": "bafyroom",
      "rkey": "room1",
      "name": "Repair Cafe",
      "description": "Weekly hardware debugging",
      "visibility": "public",
      "joinMode": "open",
      "tags": [],
      "creator": {
        "did": "did:plc:creator",
        "handle": "creator.example",
        "displayName": "Creator"
      },
      "server": {
        "did": "did:plc:pulseserver",
        "baseUrl": "https://pulse.example.com"
      },
      "recordCreatedAt": "2026-06-15T00:00:00.000Z",
      "indexedAt": "2026-06-15T00:00:00.000Z"
    }
  ]
}
```

## Rooms and Policy

### `GET /api/rooms/:roomUri`

Returns one indexed room by URL-encoded AT URI.

Response:

```json
{
  "room": {
    "uri": "at://did:plc:creator/app.pulse.room/room1",
    "cid": "bafyroom",
    "rkey": "room1",
    "name": "Repair Cafe",
    "visibility": "public",
    "joinMode": "open",
    "tags": [],
    "creator": {
      "did": "did:plc:creator",
      "handle": "creator.example",
      "displayName": "Creator"
    },
    "server": {
      "did": "did:plc:pulseserver",
      "baseUrl": "https://pulse.example.com"
    },
    "recordCreatedAt": "2026-06-15T00:00:00.000Z",
    "indexedAt": "2026-06-15T00:00:00.000Z"
  }
}
```

### `GET /api/rooms/:roomUri/policy`

Returns the room access policy derived from the indexed AT Protocol room record.

Response:

```json
{
  "roomUri": "at://did:plc:creator/app.pulse.room/room1",
  "joinMode": "open",
  "visibility": "public",
  "requiresInvite": false,
  "requestToSpeak": false,
  "serverDid": "did:plc:pulseserver"
}
```

## Invites

### `POST /api/rooms/:roomUri/invites`

Mobile-ready invite creation contract. This endpoint is intentionally not enabled
until authenticated room membership exists.

Request:

```json
{
  "recipientDid": "did:plc:invitee",
  "expiresInSeconds": 604800
}
```

Current response:

```json
{
  "error": "Room invites require authenticated room membership and are not enabled yet."
}
```

Future success response:

```json
{
  "inviteId": "inv_123",
  "roomUri": "at://did:plc:creator/app.pulse.room/room1",
  "expiresAt": "2026-06-22T00:00:00.000Z"
}
```

## Voice Token Minting

### `POST /api/voice-token`

Mobile-ready media credential minting contract. This endpoint is intentionally
not enabled until the media server credential backend is configured.

Request:

```json
{
  "roomUri": "at://did:plc:creator/app.pulse.room/room1",
  "mode": "listen"
}
```

Current response:

```json
{
  "error": "Voice token minting requires configured media credentials and is not enabled yet."
}
```

Future success response:

```json
{
  "roomUri": "at://did:plc:creator/app.pulse.room/room1",
  "token": "opaque-media-token",
  "expiresAt": "2026-06-15T00:15:00.000Z",
  "iceServers": [
    {
      "urls": "turn:turn.example.com:3478",
      "username": "alice",
      "credential": "secret"
    }
  ]
}
```
