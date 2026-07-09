import { z } from 'zod';
import { isoDateTimeSchema } from './time';

export type AutopilotCardSource = 'github-issue' | 'github-pr' | 'manual' | 'cron-scan';
export type AutopilotCardStatus = 'queued' | 'running' | 'verifying' | 'pr-open' | 'merged' | 'failed' | 'skipped';
export type AutopilotRunStatus = Extract<AutopilotCardStatus, 'running' | 'verifying' | 'pr-open' | 'merged' | 'failed'>;

export interface AutopilotCard {
  readonly id: string; readonly source: AutopilotCardSource; readonly title: string;
  readonly body: string; readonly fingerprint: string; readonly score: number;
  readonly status: AutopilotCardStatus; readonly refNumber?: number;
  readonly createdAt: string; readonly updatedAt: string; readonly runId?: string;
  readonly attempts: number; readonly lastError?: string;
}
export interface AutopilotRun {
  readonly id: string; readonly cardId: string; readonly status: AutopilotRunStatus;
  readonly worktreePath: string; readonly branch: string; readonly prUrl?: string;
  readonly attempt: number; readonly createdAt: string; readonly updatedAt: string;
  readonly verificationSummary?: string; readonly lastError?: string;
}

export const autopilotCardSourceSchema = z.enum(['github-issue', 'github-pr', 'manual', 'cron-scan']);
export const autopilotCardStatusSchema = z.enum(['queued', 'running', 'verifying', 'pr-open', 'merged', 'failed', 'skipped']);
export const autopilotRunStatusSchema = z.enum(['running', 'verifying', 'pr-open', 'merged', 'failed']);
export const autopilotCardSchema = z.object({
  id: z.string().min(1), source: autopilotCardSourceSchema, title: z.string(), body: z.string(),
  fingerprint: z.string().min(1), score: z.number(), status: autopilotCardStatusSchema,
  refNumber: z.number().int().optional(), createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema,
  runId: z.string().optional(), attempts: z.number().int(), lastError: z.string().optional(),
}) satisfies z.ZodType<AutopilotCard>;
export const autopilotRunSchema = z.object({
  id: z.string().min(1), cardId: z.string().min(1), status: autopilotRunStatusSchema,
  worktreePath: z.string(), branch: z.string(), prUrl: z.string().optional(), attempt: z.number().int(),
  createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema,
  verificationSummary: z.string().optional(), lastError: z.string().optional(),
}) satisfies z.ZodType<AutopilotRun>;
