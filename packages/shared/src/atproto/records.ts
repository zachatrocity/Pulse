export const pulseLexiconIds = {
  room: 'app.pulse.room',
  roomMember: 'app.pulse.room.member',
  roomPresence: 'app.pulse.room.presence',
  roomServer: 'app.pulse.room.server',
} as const;

export type PulseLexiconId = (typeof pulseLexiconIds)[keyof typeof pulseLexiconIds];

export type AtUri = `at://${string}`;
export type Cid = string;
export type Did = `did:${string}:${string}`;
export type DateTime = string;
export type HttpsUrl = `https://${string}`;

export interface StrongRef {
  uri: AtUri;
  cid: Cid;
}

export interface BlobRef {
  $type?: 'blob';
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}

export interface PulseRoomServerRecord {
  $type?: typeof pulseLexiconIds.roomServer;
  serviceDid: Did;
  baseUrl: HttpsUrl;
  createdAt: DateTime;
  updatedAt?: DateTime;
  software?: string;
  version?: string;
  policyUrl?: HttpsUrl;
}

export type PulseRoomVisibility = 'public' | 'inviteOnlyListing';
export type PulseRoomJoinMode = 'open' | 'request' | 'invite';

export interface PulseRoomRecord {
  $type?: typeof pulseLexiconIds.room;
  name: string;
  description?: string;
  createdAt: DateTime;
  updatedAt?: DateTime;
  visibility: PulseRoomVisibility;
  joinMode: PulseRoomJoinMode;
  language?: string;
  tags?: string[];
  server: PulseRoomServerRecord;
  avatar?: BlobRef;
}

export type PulseRoomMemberState = 'following' | 'member' | 'speaker';

export interface PulseRoomMemberRecord {
  $type?: typeof pulseLexiconIds.roomMember;
  room: StrongRef;
  createdAt: DateTime;
  state: PulseRoomMemberState;
}

export type PulseRoomPresenceStatus = 'listening' | 'speaking';

export interface PulseRoomPresenceRecord {
  $type?: typeof pulseLexiconIds.roomPresence;
  room: StrongRef;
  status: PulseRoomPresenceStatus;
  createdAt: DateTime;
  expiresAt: DateTime;
}
