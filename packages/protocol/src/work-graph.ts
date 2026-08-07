import { z } from 'zod';

import { isoDateTimeSchema } from './time';

export type WorkGraphStage =
  | 'intake'
  | 'plan'
  | 'research'
  | 'goal'
  | 'staff'
  | 'swarm'
  | 'integrate'
  | 'verify'
  | 'learn'
  | 'done';

export interface WorkGraphNode {
  readonly id: string;
  readonly title: string;
  readonly kind?: 'acceptance_criterion' | 'research' | 'implementation' | 'review' | 'verification' | 'integration' | 'learn' | 'other';
  readonly stage: WorkGraphStage;
  readonly parentId?: string;
  readonly acceptanceCriterionId?: string;
  readonly laneId?: string;
  readonly ownerExpertId?: string;
  readonly ownerAgentId?: string;
  readonly status: 'queued' | 'running' | 'blocked' | 'needs_integration' | 'done' | 'failed' | 'cancelled';
  readonly dependsOn?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly requiredEvidence?: readonly string[];
  readonly verificationStatus?: 'pending' | 'passed' | 'failed' | 'blocked';
  readonly verificationSummary?: string;
}

export interface WorkGraph {
  readonly id: string;
  readonly runId: string;
  readonly rootGoal?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly nodes: readonly WorkGraphNode[];
}

export const workGraphStageSchema = z.enum([
  'intake',
  'plan',
  'research',
  'goal',
  'staff',
  'swarm',
  'integrate',
  'verify',
  'learn',
  'done',
]) satisfies z.ZodType<WorkGraphStage>;

export const workGraphNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['acceptance_criterion', 'research', 'implementation', 'review', 'verification', 'integration', 'learn', 'other']).optional(),
  stage: workGraphStageSchema,
  parentId: z.string().min(1).optional(),
  acceptanceCriterionId: z.string().min(1).optional(),
  laneId: z.string().min(1).optional(),
  ownerExpertId: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1).optional(),
  status: z.enum(['queued', 'running', 'blocked', 'needs_integration', 'done', 'failed', 'cancelled']),
  dependsOn: z.array(z.string().min(1)).optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
  requiredEvidence: z.array(z.string().min(1)).optional(),
  verificationStatus: z.enum(['pending', 'passed', 'failed', 'blocked']).optional(),
  verificationSummary: z.string().optional(),
}) satisfies z.ZodType<WorkGraphNode>;

export const workGraphSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  rootGoal: z.string().optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  nodes: z.array(workGraphNodeSchema),
}) satisfies z.ZodType<WorkGraph>;
