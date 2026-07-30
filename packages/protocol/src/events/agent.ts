import { z } from 'zod';

import { providerRouteStatusSchema, type ProviderRouteStatus } from '../providerRoute';
import { permissionModeSchema, usageStatusSchema, type PermissionMode, type UsageStatus } from './common';

export interface AgentStatusContextOS {
  readonly pageCount: number;
  readonly readyPageCount: number;
  readonly needsRehydrationPageCount: number;
  readonly atRiskPageCount: number;
  readonly missingEvidencePageCount: number;
  readonly evidenceIdRecallScore: number;
  readonly latestContinuityStatus: string;
}

export interface AgentStatusMicroCompaction {
  readonly total: number;
  readonly lastTrigger: string | null;
  readonly lastContextUsageRatio: number | null;
  readonly byTrigger: Readonly<Record<string, number>>;
}

export interface AgentStatusAutoDream {
  readonly enabled: boolean;
  readonly inFlight: boolean;
  readonly runs: number;
  readonly lastDreamAt: number | null;
  readonly lastExamined: number | null;
  readonly lastMerged: number | null;
  readonly minHours: number;
  readonly minActiveRecords: number;
}

/** Compact worker summary for the TUI status board. */
export interface AgentStatusOrchestratorWorker {
  readonly id: string;
  readonly description: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly tokenOutput?: number;
}

export interface AgentStatusUpdatedEvent {
  readonly type: 'agent.status.updated';
  readonly model?: string;
  readonly contextTokens?: number;
  readonly maxContextTokens?: number;
  readonly contextUsage?: number;
  readonly planMode?: boolean;
  readonly swarmMode?: boolean;
  readonly premiumQualityMode?: boolean;
  readonly permission?: PermissionMode;
  readonly usage?: UsageStatus;
  readonly providerRoute?: ProviderRouteStatus | null;
  /** Present when Context OS has compacted pages; null clears prior badge. */
  readonly contextOS?: AgentStatusContextOS | null;
  /** Present when micro-compaction has fired; null clears prior badge. */
  readonly microCompaction?: AgentStatusMicroCompaction | null;
  readonly autoDream?: AgentStatusAutoDream | null;
  /** True when the agent is running in orchestrator mode (delegates work to workers). */
  readonly orchestratorMode?: boolean;
  /** Summary of active orchestrator workers for TUI display. */
  readonly orchestratorWorkers?: readonly AgentStatusOrchestratorWorker[];
}

export const agentStatusContextOSSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  readyPageCount: z.number().int().nonnegative(),
  needsRehydrationPageCount: z.number().int().nonnegative(),
  atRiskPageCount: z.number().int().nonnegative(),
  missingEvidencePageCount: z.number().int().nonnegative(),
  evidenceIdRecallScore: z.number().min(0).max(1),
  latestContinuityStatus: z.string(),
});

export const agentStatusMicroCompactionSchema = z.object({
  total: z.number().int().nonnegative(),
  lastTrigger: z.string().nullable(),
  lastContextUsageRatio: z.number().min(0).max(1).nullable(),
  byTrigger: z.record(z.string(), z.number().int().nonnegative()),
});

export const agentStatusAutoDreamSchema = z.object({
  enabled: z.boolean(),
  inFlight: z.boolean(),
  runs: z.number().int().nonnegative(),
  lastDreamAt: z.number().int().nonnegative().nullable(),
  lastExamined: z.number().int().nonnegative().nullable(),
  lastMerged: z.number().int().nonnegative().nullable(),
  minHours: z.number().positive(),
  minActiveRecords: z.number().int().positive(),
});

export const agentStatusUpdatedEventSchema = z.object({
  type: z.literal('agent.status.updated'),
  model: z.string().optional(),
  contextTokens: z.number().optional(),
  maxContextTokens: z.number().optional(),
  contextUsage: z.number().optional(),
  planMode: z.boolean().optional(),
  swarmMode: z.boolean().optional(),
  premiumQualityMode: z.boolean().optional(),
  permission: permissionModeSchema.optional(),
  usage: usageStatusSchema.optional(),
  providerRoute: providerRouteStatusSchema.nullable().optional(),
  contextOS: agentStatusContextOSSchema.nullable().optional(),
  microCompaction: agentStatusMicroCompactionSchema.nullable().optional(),
  autoDream: agentStatusAutoDreamSchema.nullable().optional(),
  orchestratorMode: z.boolean().optional(),
  orchestratorWorkers: z.array(z.object({
    id: z.string(),
    description: z.string(),
    status: z.enum(['running', 'completed', 'failed']),
    tokenOutput: z.number().optional(),
  })).optional(),
}) satisfies z.ZodType<AgentStatusUpdatedEvent>;
