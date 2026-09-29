import { z } from 'zod';

const connectionStateSchema = z.enum(['provisioning', 'qr_required', 'expired', 'connecting', 'connected', 'disconnected', 'error', 'archived']);
const publicChannelSchema = z.object({
  id: z.string().uuid(), label: z.string().nullable(),
  status: z.enum(['disconnected', 'connecting', 'connected', 'error']),
  phone_number: z.string().nullable(), archived_at: z.string().datetime().nullable(),
  managed_by: z.literal('senvia_v2'), updated_at: z.string().datetime(),
}).strict();

const looseConnectSchema = z.object({
  ok: z.literal(true),
  state: connectionStateSchema,
  channel: publicChannelSchema,
  qr: z.object({ data_url: z.string().startsWith('data:image/'), expires_at: z.string().datetime() }).strict().optional(),
  retry_after_ms: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if ((value.state === 'qr_required') !== Boolean(value.qr)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'QR incompatível com o estado da ligação' });
});

const looseConversationsSchema = z.object({
  ok: z.literal(true),
  conversations: z.array(z.object({
    messaging_permission: z.string(),
    last_message: z.object({
      delivery: z.object({ state: z.string() }).passthrough(),
    }).passthrough().nullable(),
  }).passthrough()),
}).passthrough();

export function parseConnectResponse(input: unknown) {
  return looseConnectSchema.parse(input);
}

export function parseListConversationsResponse(input: unknown) {
  return looseConversationsSchema.parse(input);
}

export function isManagedWhatsAppChannel(channel: {
  readonly channel_type: string;
  readonly provider: string;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}): boolean {
  return channel.channel_type === 'whatsapp'
    && channel.provider === 'evolution'
    && channel.metadata?.managed_by === 'senvia_v2';
}
