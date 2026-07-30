import { z } from 'zod';

import { ErrorCode, sessionStatusSchema } from '@superliora/protocol';
import type { SessionClientTelemetry } from '@superliora/agent-core';
import { workspaceIdSchema } from '@superliora/protocol';

export interface SessionRouteHost {
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown; headers: Record<string, unknown> },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; query: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;

  patch(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export const booleanQueryParam = z.preprocess(
  (value) => {
    if (value === 'true' || value === '1' || value === 1 || value === true) return true;
    if (value === 'false' || value === '0' || value === 0 || value === false) return false;
    return value;
  },
  z.boolean().optional(),
);

export const sessionsListQueryCoercion = z
  .object({
    before_id: z.string().min(1).optional(),
    after_id: z.string().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
    status: sessionStatusSchema.optional(),
    include_archive: booleanQueryParam,

    workspace_id: workspaceIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.before_id !== undefined && value.after_id !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'before_id and after_id are mutually exclusive',
        path: ['before_id'],
        params: { code: ErrorCode.VALIDATION_FAILED },
      });
    }
  });

export const sessionChildrenListQueryCoercion = z
  .object({
    before_id: z.string().min(1).optional(),
    after_id: z.string().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
    status: sessionStatusSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.before_id !== undefined && value.after_id !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'before_id and after_id are mutually exclusive',
        path: ['before_id'],
        params: { code: ErrorCode.VALIDATION_FAILED },
      });
    }
  });

export const sessionIdParamSchema = z.object({
  session_id: z.string().min(1),
});

export const sessionActionTailParamSchema = z.object({
  tail: z.string().min(1),
});

export const sessionActionRequestSchema = z.preprocess(
  (value) => value === undefined ? {} : value,
  z.object({
    title: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    instruction: z.string().optional(),
    count: z.number().int().positive().optional(),
    page_size: z.number().int().min(1).max(100).optional(),
  }),
);

export const detailsSchema = z.array(z.object({ path: z.string(), message: z.string() }));

export function clientTelemetryFromHeaders(
  headers: Record<string, unknown>,
): SessionClientTelemetry | undefined {
  const client: SessionClientTelemetry = {
    id: headerString(headers, 'x-kimi-client-id'),
    name: headerString(headers, 'x-kimi-client-name'),
    version: headerString(headers, 'x-kimi-client-version'),
    uiMode: headerString(headers, 'x-kimi-client-ui-mode'),
  };
  return Object.values(client).some((value) => value !== undefined) ? client : undefined;
}

function headerString(headers: Record<string, unknown>, key: string): string | undefined {
  const value = headers[key];
  const raw = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
