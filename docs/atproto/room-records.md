# Pulse AT Protocol Room Records

Pulse uses AT Protocol records only for public discovery and user-owned social signals. Private room authorization, invite grants, moderation decisions, call credentials, and WebRTC session state stay in the Pulse server's local database.

The checked-in Lexicons live under `packages/shared/src/lexicons`. Client-safe TypeScript types for these records are exported from `@pulse/shared`.

## Records

| NSID                      | Owner                                | Purpose                                                       |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `app.pulse.room`          | Room creator's repo                  | Public listing for a discoverable room.                       |
| `app.pulse.room.server`   | Pulse server or service account repo | Public hint for the API/signaling origin that hosts the room. |
| `app.pulse.room.member`   | Member's repo                        | Optional public membership or following signal.               |
| `app.pulse.room.presence` | Participant's repo                   | Optional coarse, short-lived public presence signal.          |

## Public Data Boundary

Public AT records may contain display metadata: room name, summary, tags, language, public join posture, server origin, and coarse self-published membership or presence. Any indexer should be able to read these records without being trusted by the room.

Private or sensitive data must remain app-local:

- private room membership lists and ACL decisions,
- invite tokens, join links, and pending invite state,
- WebRTC ICE credentials, media session IDs, and device identifiers,
- IP addresses, exact connection telemetry, and per-listener private analytics,
- moderation notes, bans, mutes, and role grants for private rooms.

An `inviteOnlyListing` room is still public metadata. It advertises that the room exists, but admission is resolved by the Pulse server's local ACL data after the user connects.

## Ownership and Indexing

`app.pulse.room` records are owned by the account that creates the room. The record key is a TID so one account can publish many room listings. Deleting the room record removes it from public discovery, but it does not by itself erase app-local room history or private ACL data.

`app.pulse.room.server` records are owned by the Pulse server or service DID and use the literal record key `self`. A room embeds this server hint so clients can reach the correct self-hosted instance without relying on a central Pulse directory.

`app.pulse.room.member` and `app.pulse.room.presence` are optional user-owned records. They are public social signals, not authority. Pulse servers may use them for discovery ranking or UI hints, but must verify real access against local room state before connecting a user.

Indexers should treat `app.pulse.room.presence.expiresAt` as a hard freshness boundary and ignore expired presence records. Presence is deliberately coarse because AT repositories are public and replicated.

## Compatibility Rules

Consumers must ignore unknown fields on all Pulse records. Producers may add optional fields without changing the NSID when older clients can safely ignore them.

Changing required fields, changing enum meaning, or moving private ACL state into public records requires a new Lexicon or a documented breaking migration. The paved-road upgrade path should keep old public room records readable for at least one release window.

Room access is never granted by AT records alone. The Pulse server at `server.baseUrl` remains the authority for joining, speaking, moderation, and private room membership.
