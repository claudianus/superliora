import { z } from 'zod';

import { isoDateTimeSchema } from './time';

export type UltraworkStage =
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

export type UltraworkRunStatus = 'running' | 'blocked' | 'failed' | 'done';
export type ResearchIntensity = 'balanced' | 'premium' | 'max';

export type ResearchBackendKind =
  | 'local_research_stack'
  | 'kimi_web_search'
  | 'openai_web_search'
  | 'anthropic_web_search'
  | 'moonshot_service_search'
  | 'mcp_search';

export type ResearchBackendRole = 'primary' | 'assist' | 'fallback';
export type ResearchBackendStatus = 'available' | 'selected' | 'failed' | 'disabled';

export interface ResearchBackend {
  readonly id: string;
  readonly kind: ResearchBackendKind;
  readonly role: ResearchBackendRole;
  readonly status: ResearchBackendStatus;
  readonly label?: string;
  readonly failureReason?: string;
}

export type ResearchEvidenceSourceType =
  | 'official_docs'
  | 'paper'
  | 'oss'
  | 'security'
  | 'release_notes'
  | 'benchmark'
  | 'package_registry'
  | 'workspace'
  | 'memory'
  | 'wiki'
  | 'web'
  | 'unknown';

export type ResearchEvidenceVerificationStatus =
  | 'candidate'
  | 'verified'
  | 'rejected'
  | 'stale'
  | 'offline';

export interface ResearchEvidence {
  readonly id: string;
  readonly title: string;
  readonly sourceType: ResearchEvidenceSourceType;
  readonly backendId: string;
  readonly retrievedAt: string;
  readonly url?: string;
  readonly publishedAt?: string;
  readonly snippet?: string;
  readonly contentHash?: string;
  readonly verificationStatus: ResearchEvidenceVerificationStatus;
  readonly verificationReason?: string;
  readonly primarySource?: boolean;
}

export interface ResearchEvidencePack {
  readonly id: string;
  readonly runId: string;
  readonly topic: string;
  readonly generatedAt: string;
  readonly evidence: readonly ResearchEvidence[];
  readonly verifiedFindingIds: readonly string[];
  readonly caveats?: readonly string[];
}

export interface UltraResearchRun {
  readonly id: string;
  readonly status: UltraworkRunStatus;
  readonly startedAt: string;
  readonly intensity: ResearchIntensity;
  readonly backends: readonly ResearchBackend[];
  readonly endedAt?: string;
  readonly evidencePack?: ResearchEvidencePack;
}

export interface TeamExpertAssignment {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly focus: 'plan' | 'research' | 'implement' | 'review' | 'full';
  readonly status: 'queued' | 'running' | 'blocked' | 'done' | 'failed';
  readonly taskIds?: readonly string[];
  readonly division?: string;
  readonly emoji?: string;
  readonly color?: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
  readonly dependsOn?: readonly string[];
  readonly agentId?: string;
}

export interface TeamPlan {
  readonly id: string;
  readonly runId: string;
  readonly intensity: ResearchIntensity;
  readonly maxExperts: number;
  readonly requiredExperts?: readonly string[];
  readonly experts: readonly TeamExpertAssignment[];
  readonly councilExpertIds?: readonly string[];
  readonly reason?: string;
}

export interface WorkGraphNode {
  readonly id: string;
  readonly title: string;
  readonly kind?: 'acceptance_criterion' | 'research' | 'implementation' | 'review' | 'verification' | 'integration' | 'learn' | 'other';
  readonly stage: UltraworkStage;
  readonly parentId?: string;
  readonly acceptanceCriterionId?: string;
  readonly laneId?: string;
  readonly ownerExpertId?: string;
  readonly ownerAgentId?: string;
  readonly status: 'queued' | 'running' | 'blocked' | 'done' | 'failed';
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

export interface CouncilDecision {
  readonly id: string;
  readonly runId: string;
  readonly stage: UltraworkStage;
  readonly decision: 'approve' | 'revise' | 'block';
  readonly reason: string;
  readonly reviewerExpertIds?: readonly string[];
  readonly riskAreas?: readonly ('architecture' | 'security' | 'qa' | 'performance' | 'ux' | 'research')[];
}

export interface VerificationResult {
  readonly id: string;
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly checks: readonly {
    readonly name: string;
    readonly status: 'passed' | 'failed' | 'skipped' | 'blocked';
    readonly command?: string;
    readonly summary?: string;
  }[];
  readonly completedAt: string;
}

export type KnowledgePromotionTarget = 'liora_recall' | 'llm_wiki';

export interface KnowledgePromotion {
  readonly id: string;
  readonly runId: string;
  readonly target: KnowledgePromotionTarget;
  readonly findingId: string;
  readonly title: string;
  readonly promotedAt: string;
  readonly sourceEvidenceIds: readonly string[];
}

export interface UltraworkRun {
  readonly id: string;
  readonly objective: string;
  readonly status: UltraworkRunStatus;
  readonly stage: UltraworkStage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stageHistory?: readonly {
    readonly stage: UltraworkStage;
    readonly enteredAt: string;
    readonly reason?: string;
  }[];
  readonly researchRun?: UltraResearchRun;
  readonly teamPlan?: TeamPlan;
  readonly workGraph?: WorkGraph;
  readonly verification?: VerificationResult;
  readonly knowledgePromotions?: readonly KnowledgePromotion[];
}

export const ultraworkStageSchema = z.enum([
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
]) satisfies z.ZodType<UltraworkStage>;

export const ultraworkRunStatusSchema = z.enum([
  'running',
  'blocked',
  'failed',
  'done',
]) satisfies z.ZodType<UltraworkRunStatus>;

export const researchIntensitySchema = z.enum([
  'balanced',
  'premium',
  'max',
]) satisfies z.ZodType<ResearchIntensity>;

export const researchBackendSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'local_research_stack',
    'kimi_web_search',
    'openai_web_search',
    'anthropic_web_search',
    'moonshot_service_search',
    'mcp_search',
  ]),
  role: z.enum(['primary', 'assist', 'fallback']),
  status: z.enum(['available', 'selected', 'failed', 'disabled']),
  label: z.string().optional(),
  failureReason: z.string().optional(),
}) satisfies z.ZodType<ResearchBackend>;

export const researchEvidenceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceType: z.enum([
    'official_docs',
    'paper',
    'oss',
    'security',
    'release_notes',
    'benchmark',
    'package_registry',
    'workspace',
    'memory',
    'wiki',
    'web',
    'unknown',
  ]),
  backendId: z.string().min(1),
  retrievedAt: isoDateTimeSchema,
  url: z.string().url().optional(),
  publishedAt: isoDateTimeSchema.optional(),
  snippet: z.string().optional(),
  contentHash: z.string().optional(),
  verificationStatus: z.enum(['candidate', 'verified', 'rejected', 'stale', 'offline']),
  verificationReason: z.string().optional(),
  primarySource: z.boolean().optional(),
}) satisfies z.ZodType<ResearchEvidence>;

export const researchEvidencePackSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  topic: z.string().min(1),
  generatedAt: isoDateTimeSchema,
  evidence: z.array(researchEvidenceSchema),
  verifiedFindingIds: z.array(z.string().min(1)),
  caveats: z.array(z.string()).optional(),
}) satisfies z.ZodType<ResearchEvidencePack>;

export const ultraResearchRunSchema = z.object({
  id: z.string().min(1),
  status: ultraworkRunStatusSchema,
  startedAt: isoDateTimeSchema,
  intensity: researchIntensitySchema,
  backends: z.array(researchBackendSchema),
  endedAt: isoDateTimeSchema.optional(),
  evidencePack: researchEvidencePackSchema.optional(),
}) satisfies z.ZodType<UltraResearchRun>;

export const teamExpertAssignmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  focus: z.enum(['plan', 'research', 'implement', 'review', 'full']),
  status: z.enum(['queued', 'running', 'blocked', 'done', 'failed']),
  taskIds: z.array(z.string().min(1)).optional(),
  division: z.string().min(1).optional(),
  emoji: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  coverageLane: z.string().min(1).optional(),
  selectionReason: z.string().min(1).optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  agentId: z.string().min(1).optional(),
}) satisfies z.ZodType<TeamExpertAssignment>;

export const teamPlanSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  intensity: researchIntensitySchema,
  maxExperts: z.number().int().min(1).max(128),
  requiredExperts: z.array(z.string().min(1)).optional(),
  experts: z.array(teamExpertAssignmentSchema),
  councilExpertIds: z.array(z.string().min(1)).optional(),
  reason: z.string().optional(),
}) satisfies z.ZodType<TeamPlan>;

export const workGraphNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['acceptance_criterion', 'research', 'implementation', 'review', 'verification', 'integration', 'learn', 'other']).optional(),
  stage: ultraworkStageSchema,
  parentId: z.string().min(1).optional(),
  acceptanceCriterionId: z.string().min(1).optional(),
  laneId: z.string().min(1).optional(),
  ownerExpertId: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1).optional(),
  status: z.enum(['queued', 'running', 'blocked', 'done', 'failed']),
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

export const councilDecisionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stage: ultraworkStageSchema,
  decision: z.enum(['approve', 'revise', 'block']),
  reason: z.string().min(1),
  reviewerExpertIds: z.array(z.string().min(1)).optional(),
  riskAreas: z.array(z.enum(['architecture', 'security', 'qa', 'performance', 'ux', 'research'])).optional(),
}) satisfies z.ZodType<CouncilDecision>;

export const verificationResultSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'blocked']),
  checks: z.array(z.object({
    name: z.string().min(1),
    status: z.enum(['passed', 'failed', 'skipped', 'blocked']),
    command: z.string().optional(),
    summary: z.string().optional(),
  })),
  completedAt: isoDateTimeSchema,
}) satisfies z.ZodType<VerificationResult>;

const knowledgePromotionTargetSchema = z.preprocess(
  (value) => (value === 'kimi_recall' ? 'liora_recall' : value),
  z.enum(['liora_recall', 'llm_wiki']),
);

export const knowledgePromotionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  target: knowledgePromotionTargetSchema,
  findingId: z.string().min(1),
  title: z.string().min(1),
  promotedAt: isoDateTimeSchema,
  sourceEvidenceIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<KnowledgePromotion>;

export const ultraworkRunSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  status: ultraworkRunStatusSchema,
  stage: ultraworkStageSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  stageHistory: z.array(z.object({
    stage: ultraworkStageSchema,
    enteredAt: isoDateTimeSchema,
    reason: z.string().optional(),
  })).optional(),
  researchRun: ultraResearchRunSchema.optional(),
  teamPlan: teamPlanSchema.optional(),
  workGraph: workGraphSchema.optional(),
  verification: verificationResultSchema.optional(),
  knowledgePromotions: z.array(knowledgePromotionSchema).optional(),
}) satisfies z.ZodType<UltraworkRun>;
