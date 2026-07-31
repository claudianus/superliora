import { z } from 'zod';

/**
 * Never-Halt degradation signal — Goal/Mission/Fleet keep running.
 * Volatile: clients recover from live stream + Ops footer, not journal replay.
 */
export type RuntimeDegradedScope =
  | 'search'
  | 'oauth'
  | 'llm'
  | 'mcp'
  | 'permission'
  | 'network'
  | 'other';

export interface RuntimeDegradedEvent {
  readonly type: 'runtime.degraded';
  readonly scope: RuntimeDegradedScope;
  readonly reason: string;
  readonly hint?: string;
  readonly toolCallId?: string;
  readonly atMs?: number;
}

export const runtimeDegradedScopeSchema = z.enum([
  'search',
  'oauth',
  'llm',
  'mcp',
  'permission',
  'network',
  'other',
]) satisfies z.ZodType<RuntimeDegradedScope>;

export const runtimeDegradedEventSchema = z.object({
  type: z.literal('runtime.degraded'),
  scope: runtimeDegradedScopeSchema,
  reason: z.string(),
  hint: z.string().optional(),
  toolCallId: z.string().optional(),
  atMs: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<RuntimeDegradedEvent>;

/** Never-Halt circuit breaker scope snapshot for Ops / Settings. */
export interface CircuitBreakerScopeStatus {
  readonly id: string;
  readonly state: string;
  readonly failures: number;
  readonly lastTripReason?: string;
}

/** Aggregated circuit breaker counts + per-scope detail from agent-core registry. */
export interface CircuitBreakerStatus {
  readonly closed: number;
  readonly open: number;
  readonly halfOpen: number;
  readonly lastTripReason?: string;
  readonly scopes?: readonly CircuitBreakerScopeStatus[];
}

export const circuitBreakerScopeStatusSchema = z.object({
  id: z.string(),
  state: z.string(),
  failures: z.number().int().nonnegative(),
  lastTripReason: z.string().optional(),
});

export const circuitBreakerStatusSchema = z.object({
  closed: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  halfOpen: z.number().int().nonnegative(),
  lastTripReason: z.string().optional(),
  scopes: z.array(circuitBreakerScopeStatusSchema).optional(),
}) satisfies z.ZodType<CircuitBreakerStatus>;
