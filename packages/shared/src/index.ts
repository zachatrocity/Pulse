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

export const appInfo: AppInfo = {
  name: 'Pulse',
  version: '0.1.0',
  identity: 'atproto',
  media: 'webrtc',
};
