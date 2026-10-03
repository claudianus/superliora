import { z } from 'zod';

import { providerRouteStatusSchema, type ProviderRouteStatus } from '../providerRoute';
import { permissionModeSchema, usageStatusSchema, type PermissionMode, type UsageStatus } from './common';
import { circuitBreakerStatusSchema, type CircuitBreakerStatus } from './runtime';


export interface AgentStatusUpdatedEvent {
  readonly type: 'agent.status.updated';
  readonly model?: string;
  readonly contextTokens?: number;
  readonly maxContextTokens?: number;
  readonly contextUsage?: number;
  readonly permission?: PermissionMode;
  readonly usage?: UsageStatus;
  readonly providerRoute?: ProviderRouteStatus | null;
  /** Non-blocking permission interventions waiting on host approval. */
  readonly pendingInterventions?: number;
  /** Queue entries older than 120s (visibility only; no auto-deny). */
  readonly staleInterventions?: number;
  /** Age in ms of the longest-waiting queued intervention (Ops/Never-Halt glance). */
  readonly oldestInterventionAgeMs?: number;
  /** Never-Halt circuit breaker registry snapshot when wired by agent-core. */
  readonly circuitBreakers?: CircuitBreakerStatus;
}


export const agentStatusUpdatedEventSchema = z.object({
  type: z.literal('agent.status.updated'),
  model: z.string().optional(),
  contextTokens: z.number().optional(),
  maxContextTokens: z.number().optional(),
  contextUsage: z.number().optional(),
  permission: permissionModeSchema.optional(),
  usage: usageStatusSchema.optional(),
  providerRoute: providerRouteStatusSchema.nullable().optional(),
  pendingInterventions: z.number().int().nonnegative().optional(),
  staleInterventions: z.number().int().nonnegative().optional(),
  oldestInterventionAgeMs: z.number().int().nonnegative().optional(),
  circuitBreakers: circuitBreakerStatusSchema.optional(),
}) satisfies z.ZodType<AgentStatusUpdatedEvent>;
