import { z } from 'zod';

import {
  councilDecisionSchema,
  knowledgePromotionSchema,
  researchBackendSchema,
  researchEvidenceSchema,
  swarmBusMessageSchema,
  teamPlanSchema,
  ultraworkRunSchema,
  ultraworkStageSchema,
  verificationResultSchema,
  workGraphNodeSchema,
  type CouncilDecision,
  type KnowledgePromotion,
  type ResearchBackend,
  type ResearchEvidence,
  type SwarmBusMessage,
  type TeamPlan,
  type UltraworkRun,
  type UltraworkStage,
  type VerificationResult,
  type WorkGraphNode,
} from '../ultrawork';

export interface UltraworkStageChangedEvent {
  readonly type: 'ultrawork.stage.changed';
  readonly run: UltraworkRun;
  readonly from?: UltraworkStage;
  readonly to: UltraworkStage;
  readonly reason?: string;
}

export interface UltraworkResearchStartedEvent {
  readonly type: 'ultrawork.research.started';
  readonly runId: string;
  readonly topic: string;
  readonly backends: readonly ResearchBackend[];
}

export interface UltraworkResearchProviderSelectedEvent {
  readonly type: 'ultrawork.research.provider.selected';
  readonly runId: string;
  readonly backend: ResearchBackend;
}

export interface UltraworkResearchFindingVerifiedEvent {
  readonly type: 'ultrawork.research.finding.verified';
  readonly runId: string;
  readonly evidence: ResearchEvidence;
}

export interface UltraworkTeamStaffedEvent {
  readonly type: 'ultrawork.team.staffed';
  readonly runId: string;
  readonly toolCallId?: string;
  readonly team: TeamPlan;
}

export interface UltraworkRoutingDecidedEvent {
  readonly type: 'ultrawork.routing.decided';
  readonly runId: string;
  readonly toolCallId?: string;
  readonly decision: 'ENGAGE' | 'ADAPTIVE' | 'DEFER';
  readonly intensity: 'light' | 'standard' | 'heavy';
  readonly estimatedExperts: number;
  readonly rationale: string;
}

export interface UltraworkTaskAssignedEvent {
  readonly type: 'ultrawork.task.assigned';
  readonly runId: string;
  readonly task: WorkGraphNode;
}

export interface UltraworkCollaborationMessageEvent {
  readonly type: 'ultrawork.collaboration.message';
  readonly runId: string;
  readonly message: SwarmBusMessage;
}

export interface UltraworkCollaborationMentionEvent {
  readonly type: 'ultrawork.collaboration.mention';
  readonly runId: string;
  readonly message: SwarmBusMessage;
  readonly mentionExpertIds: readonly string[];
}

export interface UltraworkCollaborationDebateEvent {
  readonly type: 'ultrawork.collaboration.debate';
  readonly runId: string;
  readonly debateId: string;
  readonly workNodeId: string;
  readonly phase: 'critic' | 'rebuttal' | 'counter-critique' | 'consensus';
  readonly expertId: string;
  readonly expertName: string;
  readonly text: string;
  readonly stance?: 'support' | 'oppose' | 'neutral';
  readonly parentId?: string;
}

export interface UltraworkCollaborationSteerEvent {
  readonly type: 'ultrawork.collaboration.steer';
  readonly runId: string;
  readonly debateId: string;
  readonly text: string;
  readonly fromUser: boolean;
}

export interface UltraworkCouncilDecisionEvent {
  readonly type: 'ultrawork.council.decision';
  readonly runId: string;
  readonly decision: CouncilDecision;
}

export interface UltraworkSwarmPausedEvent {
  readonly type: 'ultrawork.swarm.paused';
  readonly runId: string;
  readonly reason: string;
  readonly input?: string;
  readonly phase?: string;
}

export interface UltraworkSwarmResumedEvent {
  readonly type: 'ultrawork.swarm.resumed';
  readonly runId: string;
  readonly reason?: string;
}

export interface UltraworkVerificationCompletedEvent {
  readonly type: 'ultrawork.verification.completed';
  readonly runId: string;
  readonly verification: VerificationResult;
}

export interface UltraworkKnowledgePromotedEvent {
  readonly type: 'ultrawork.knowledge.promoted';
  readonly runId: string;
  readonly promotion: KnowledgePromotion;
}

export const ultraworkStageChangedEventSchema = z.object({
  type: z.literal('ultrawork.stage.changed'),
  run: ultraworkRunSchema,
  from: ultraworkStageSchema.optional(),
  to: ultraworkStageSchema,
  reason: z.string().optional(),
}) satisfies z.ZodType<UltraworkStageChangedEvent>;

export const ultraworkResearchStartedEventSchema = z.object({
  type: z.literal('ultrawork.research.started'),
  runId: z.string().min(1),
  topic: z.string().min(1),
  backends: z.array(researchBackendSchema),
}) satisfies z.ZodType<UltraworkResearchStartedEvent>;

export const ultraworkResearchProviderSelectedEventSchema = z.object({
  type: z.literal('ultrawork.research.provider.selected'),
  runId: z.string().min(1),
  backend: researchBackendSchema,
}) satisfies z.ZodType<UltraworkResearchProviderSelectedEvent>;

export const ultraworkResearchFindingVerifiedEventSchema = z.object({
  type: z.literal('ultrawork.research.finding.verified'),
  runId: z.string().min(1),
  evidence: researchEvidenceSchema,
}) satisfies z.ZodType<UltraworkResearchFindingVerifiedEvent>;

export const ultraworkTeamStaffedEventSchema = z.object({
  type: z.literal('ultrawork.team.staffed'),
  runId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  team: teamPlanSchema,
}) satisfies z.ZodType<UltraworkTeamStaffedEvent>;

export const ultraworkRoutingDecidedEventSchema = z.object({
  type: z.literal('ultrawork.routing.decided'),
  runId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  decision: z.enum(['ENGAGE', 'ADAPTIVE', 'DEFER']),
  intensity: z.enum(['light', 'standard', 'heavy']),
  estimatedExperts: z.number().int().min(0),
  rationale: z.string().min(1),
}) satisfies z.ZodType<UltraworkRoutingDecidedEvent>;

export const ultraworkTaskAssignedEventSchema = z.object({
  type: z.literal('ultrawork.task.assigned'),
  runId: z.string().min(1),
  task: workGraphNodeSchema,
}) satisfies z.ZodType<UltraworkTaskAssignedEvent>;

export const ultraworkCollaborationMessageEventSchema = z.object({
  type: z.literal('ultrawork.collaboration.message'),
  runId: z.string().min(1),
  message: swarmBusMessageSchema,
}) satisfies z.ZodType<UltraworkCollaborationMessageEvent>;

export const ultraworkCollaborationMentionEventSchema = z.object({
  type: z.literal('ultrawork.collaboration.mention'),
  runId: z.string().min(1),
  message: swarmBusMessageSchema,
  mentionExpertIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<UltraworkCollaborationMentionEvent>;

export const ultraworkCollaborationDebateEventSchema = z.object({
  type: z.literal('ultrawork.collaboration.debate'),
  runId: z.string().min(1),
  debateId: z.string().min(1),
  workNodeId: z.string().min(1),
  phase: z.enum(['critic', 'rebuttal', 'counter-critique', 'consensus']),
  expertId: z.string().min(1),
  expertName: z.string().min(1),
  text: z.string(),
  stance: z.enum(['support', 'oppose', 'neutral']).optional(),
  parentId: z.string().optional(),
}) satisfies z.ZodType<UltraworkCollaborationDebateEvent>;

export const ultraworkCollaborationSteerEventSchema = z.object({
  type: z.literal('ultrawork.collaboration.steer'),
  runId: z.string().min(1),
  debateId: z.string().min(1),
  text: z.string(),
  fromUser: z.boolean(),
}) satisfies z.ZodType<UltraworkCollaborationSteerEvent>;

export const ultraworkCouncilDecisionEventSchema = z.object({
  type: z.literal('ultrawork.council.decision'),
  runId: z.string().min(1),
  decision: councilDecisionSchema,
}) satisfies z.ZodType<UltraworkCouncilDecisionEvent>;

export const ultraworkSwarmPausedEventSchema = z.object({
  type: z.literal('ultrawork.swarm.paused'),
  runId: z.string().min(1),
  reason: z.string().min(1),
  input: z.string().optional(),
  phase: z.string().optional(),
}) satisfies z.ZodType<UltraworkSwarmPausedEvent>;

export const ultraworkSwarmResumedEventSchema = z.object({
  type: z.literal('ultrawork.swarm.resumed'),
  runId: z.string().min(1),
  reason: z.string().optional(),
}) satisfies z.ZodType<UltraworkSwarmResumedEvent>;


export const ultraworkVerificationCompletedEventSchema = z.object({
  type: z.literal('ultrawork.verification.completed'),
  runId: z.string().min(1),
  verification: verificationResultSchema,
}) satisfies z.ZodType<UltraworkVerificationCompletedEvent>;

export const ultraworkKnowledgePromotedEventSchema = z.object({
  type: z.literal('ultrawork.knowledge.promoted'),
  runId: z.string().min(1),
  promotion: knowledgePromotionSchema,
}) satisfies z.ZodType<UltraworkKnowledgePromotedEvent>;
