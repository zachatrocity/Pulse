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

export const appInfo: AppInfo = {
  name: 'Pulse',
  version: '0.1.0',
  identity: 'atproto',
  media: 'webrtc',
};

export * from './atproto/records.js';
