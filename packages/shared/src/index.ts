import { z } from 'zod';

export const appInfoSchema = z.object({
  name: z.literal('Pulse'),
  version: z.string(),
  identity: z.literal('atproto'),
  media: z.literal('webrtc'),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

export const healthSchema = z.object({
  ok: z.boolean(),
  service: z.literal('pulse-api'),
  version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

export const authSessionSchema = z.object({
  authenticated: z.literal(true),
  did: z.string().startsWith('did:'),
  handle: z.string().min(1),
  pdsEndpoint: z.string().url(),
  scope: z.string().min(1),
  tokenExpiresAt: z.string().datetime().optional(),
});

export const anonymousAuthSessionSchema = z.object({
  authenticated: z.literal(false),
});

export const authStatusSchema = z.discriminatedUnion('authenticated', [
  authSessionSchema,
  anonymousAuthSessionSchema,
]);

export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const authLoginRequestSchema = z.object({
  handle: z.string().trim().min(1).max(253),
});

export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;

export const authLoginResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});

export type AuthLoginResponse = z.infer<typeof authLoginResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const roomSummarySchema = z.object({
  uri: z.string().startsWith('at://'),
  cid: z.string().min(1),
  repo: z.string().startsWith('did:'),
  rkey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: z.enum(['public', 'inviteOnlyListing']),
  joinMode: z.enum(['open', 'request', 'invite']),
  language: z.string().optional(),
  tags: z.array(z.string()),
  serverDid: z.string().startsWith('did:'),
  serverBaseUrl: z.string().url(),
  recordCreatedAt: z.string().datetime(),
  recordUpdatedAt: z.string().datetime().optional(),
  indexedAt: z.string().datetime(),
});

export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const roomListResponseSchema = z.object({
  rooms: z.array(roomSummarySchema),
});

export type RoomListResponse = z.infer<typeof roomListResponseSchema>;

export const roomDetailResponseSchema = z.object({
  room: roomSummarySchema,
});

export type RoomDetailResponse = z.infer<typeof roomDetailResponseSchema>;

export const roomPolicyResponseSchema = z.object({
  roomUri: z.string().startsWith('at://'),
  joinMode: z.enum(['open', 'request', 'invite']),
  visibility: z.enum(['public', 'inviteOnlyListing']),
  requiresInvite: z.boolean(),
  requestToSpeak: z.boolean(),
  serverDid: z.string().startsWith('did:'),
});

export type RoomPolicyResponse = z.infer<typeof roomPolicyResponseSchema>;

export const createInviteRequestSchema = z.object({
  recipientDid: z.string().startsWith('did:').optional(),
  expiresInSeconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 30)
    .optional(),
});

export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const createInviteResponseSchema = z.object({
  inviteId: z.string().min(1),
  roomUri: z.string().startsWith('at://'),
  expiresAt: z.string().datetime().optional(),
});

export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

export const voiceTokenRequestSchema = z.object({
  roomUri: z.string().startsWith('at://'),
  mode: z.enum(['listen', 'speak']).default('listen'),
});

export type VoiceTokenRequest = z.infer<typeof voiceTokenRequestSchema>;

export const voiceTokenResponseSchema = z.object({
  roomUri: z.string().startsWith('at://'),
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  iceServers: z.array(
    z.object({
      urls: z.union([z.string().url(), z.array(z.string().url())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
});

export type VoiceTokenResponse = z.infer<typeof voiceTokenResponseSchema>;

export const appInfo: AppInfo = {
  name: 'Pulse',
  version: '0.1.0',
  identity: 'atproto',
  media: 'webrtc',
};

export * from './atproto/records.js';
