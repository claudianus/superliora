import { z } from 'zod';

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'complete';
export type GoalActor = 'user' | 'model' | 'runtime' | 'system';

export interface GoalBudgetLimits {
  readonly tokenBudget?: number;
  readonly turnBudget?: number;
  readonly wallClockBudgetMs?: number;
}

export interface GoalBudgetReport {
  readonly tokenBudget: number | null;
  readonly turnBudget: number | null;
  readonly wallClockBudgetMs: number | null;
  readonly remainingTokens: number | null;
  readonly remainingTurns: number | null;
  readonly remainingWallClockMs: number | null;
  readonly tokenBudgetReached: boolean;
  readonly turnBudgetReached: boolean;
  readonly wallClockBudgetReached: boolean;
  readonly overBudget: boolean;
}

export type GoalExecutionLane = 'agent' | 'goal-desk';

export interface GoalSnapshot {
  readonly goalId: string;
  readonly objective: string;
  readonly completionCriterion?: string;
  readonly status: GoalStatus;
  readonly turnsUsed: number;
  readonly tokensUsed: number;
  readonly wallClockMs: number;
  readonly budget: GoalBudgetReport;
  readonly terminalReason?: string;
  readonly execution?: GoalExecutionLane;
  readonly deskJobId?: string;
}

export interface GoalToolResult {
  readonly goal: GoalSnapshot | null;
}

export interface GoalChangeStats {
  readonly turnsUsed: number;
  readonly tokensUsed: number;
  readonly wallClockMs: number;
}

export type GoalChangeKind = 'lifecycle' | 'completion';

export interface GoalChange {
  readonly kind: GoalChangeKind;
  readonly status?: GoalStatus;
  readonly reason?: string;
  readonly stats?: GoalChangeStats;
  readonly actor?: GoalActor;
}

export interface GoalUpdatedEvent {
  readonly type: 'goal.updated';
  readonly snapshot: GoalSnapshot | null;
  readonly change?: GoalChange;
}

export const goalStatusSchema = z.enum(['active', 'paused', 'blocked', 'complete']) satisfies z.ZodType<GoalStatus>;

export const goalActorSchema = z.enum(['user', 'model', 'runtime', 'system']) satisfies z.ZodType<GoalActor>;

export const goalBudgetLimitsSchema = z.object({
  tokenBudget: z.number().optional(),
  turnBudget: z.number().optional(),
  wallClockBudgetMs: z.number().optional(),
}) satisfies z.ZodType<GoalBudgetLimits>;

export const goalBudgetReportSchema = z.object({
  tokenBudget: z.number().nullable(),
  turnBudget: z.number().nullable(),
  wallClockBudgetMs: z.number().nullable(),
  remainingTokens: z.number().nullable(),
  remainingTurns: z.number().nullable(),
  remainingWallClockMs: z.number().nullable(),
  tokenBudgetReached: z.boolean(),
  turnBudgetReached: z.boolean(),
  wallClockBudgetReached: z.boolean(),
  overBudget: z.boolean(),
}) satisfies z.ZodType<GoalBudgetReport>;

export const goalExecutionLaneSchema = z.enum(['agent', 'goal-desk']) satisfies z.ZodType<GoalExecutionLane>;

export const goalSnapshotSchema = z.object({
  goalId: z.string(),
  objective: z.string(),
  completionCriterion: z.string().optional(),
  status: goalStatusSchema,
  turnsUsed: z.number(),
  tokensUsed: z.number(),
  wallClockMs: z.number(),
  budget: goalBudgetReportSchema,
  terminalReason: z.string().optional(),
  execution: goalExecutionLaneSchema.optional(),
  deskJobId: z.string().optional(),
}) satisfies z.ZodType<GoalSnapshot>;

export const goalToolResultSchema = z.object({
  goal: goalSnapshotSchema.nullable(),
}) satisfies z.ZodType<GoalToolResult>;

export const goalChangeStatsSchema = z.object({
  turnsUsed: z.number(),
  tokensUsed: z.number(),
  wallClockMs: z.number(),
}) satisfies z.ZodType<GoalChangeStats>;

export const goalChangeKindSchema = z.enum(['lifecycle', 'completion']) satisfies z.ZodType<GoalChangeKind>;

export const goalChangeSchema = z.object({
  kind: goalChangeKindSchema,
  status: goalStatusSchema.optional(),
  reason: z.string().optional(),
  stats: goalChangeStatsSchema.optional(),
  actor: goalActorSchema.optional(),
}) satisfies z.ZodType<GoalChange>;

export const goalUpdatedEventSchema = z.object({
  type: z.literal('goal.updated'),
  snapshot: goalSnapshotSchema.nullable(),
  change: goalChangeSchema.optional(),
}) satisfies z.ZodType<GoalUpdatedEvent>;
