import { z } from 'zod';

export const VERSION = '0.3.0';
export const PROTOCOL_VERSION = 2;
export const providerSchema = z.enum(['claude-code', 'codex', 'test']);
export type Provider = z.infer<typeof providerSchema>;
export const handleSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const idSchema = z.string().uuid();
export const contextSchema = z.object({
  provider: providerSchema,
  workspace: z.string().min(1).max(2048),
}).strict();
export type CallerContext = z.infer<typeof contextSchema>;

export const schemas = {
  session_register: z.object({
    name: z.string().trim().min(1).max(80),
    resumeHandle: handleSchema.optional(),
  }).strict(),
  sessions_list: z.object({
    sessionHandle: handleSchema,
    cursor: idSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }).strict(),
  message_send: z.object({
    sessionHandle: handleSchema,
    to: idSchema,
    body: z.string().trim().min(1).max(16000),
    idempotencyKey: z.string().min(1).max(128),
  }).strict(),
  inbox_read: z.object({
    sessionHandle: handleSchema,
    limit: z.number().int().min(1).max(100).default(20),
  }).strict(),
  message_ack: z.object({
    sessionHandle: handleSchema,
    messageIds: z.array(idSchema).min(1).max(100),
  }).strict(),
  message_reply: z.object({
    sessionHandle: handleSchema,
    messageId: idSchema,
    body: z.string().trim().min(1).max(16000),
    idempotencyKey: z.string().min(1).max(128),
  }).strict(),
  message_status: z.object({sessionHandle: handleSchema, messageId: idSchema}).strict(),
  session_heartbeat: z.object({sessionHandle: handleSchema}).strict(),
} as const;
export type Method = keyof typeof schemas;

export class BridgeError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function fail(code: string, message: string, status = 400): never {
  throw new BridgeError(code, message, status);
}

export interface Session {
  id: string;
  name: string;
  provider: Provider;
  workspace: string;
  createdAt: number;
  lastSeenAt: number;
  delivery: 'pull-only';
}

export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  conversationId: string;
  inReplyTo: string | null;
  createdAt: number;
  expiresAt: number;
  offeredAt: number | null;
  acknowledgedAt: number | null;
  contentExpiresAt: number;
  retentionUntil: number;
  contentDeletedAt: number | null;
  status: 'queued' | 'offered' | 'acknowledged' | 'expired';
}
