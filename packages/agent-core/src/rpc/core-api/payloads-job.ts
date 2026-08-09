/**
 * Conductor Job RPC payloads — deterministic host/SDK control surface (no LLM).
 */

import type { JobSnapshot } from '@superliora/protocol';

import type {
  ConductorProjectMode,
  JobActionResult,
  JobCreateInput,
  JobCreateResult,
  JobGcWorktreesResult,
  JobInboxResult,
  JobInspectResult,
  JobMergeInput,
  JobMergeResult,
  JobPushInput,
  JobPushResult,
  JobResumeResult,
  JobSetProjectModeResult,
} from '#/tools/builtin/job/job-rpc-api';
import type { SplitJobIntent } from '#/tools/builtin/job/job-split';
import type { JobKind, JobStatus } from '#/tools/builtin/job/job-store-key';

export type {
  ConductorProjectMode,
  JobActionResult,
  JobCreateInput,
  JobCreateResult,
  JobGcWorktreesResult,
  JobInboxResult,
  JobInspectResult,
  JobMergeInput,
  JobMergeResult,
  JobPushInput,
  JobPushResult,
  JobResumeResult,
  JobSetProjectModeResult,
  JobSnapshot,
  SplitJobIntent,
};

export type JobCreatePayload = JobCreateInput;

export interface JobCreateBatchPayload {
  readonly jobs: readonly JobCreateInput[];
}

export interface JobIdPayload {
  readonly jobId: string;
}

export interface JobInboxPayload {
  readonly markRead?: boolean;
  readonly limit?: number;
}

export interface JobSteerPayload {
  readonly jobId: string;
  readonly message: string;
  readonly status?: JobStatus;
}

export interface JobCancelPayload {
  readonly jobId: string;
  readonly reason?: string;
}

export interface JobResumePayload {
  readonly jobId?: string;
  readonly answer?: string;
}

export type JobMergePayload = JobMergeInput;

export type JobPushPayload = JobPushInput;

export interface JobPreviewSplitPayload {
  readonly text: string;
}

export interface JobGcWorktreesPayload {
  readonly dryRun?: boolean;
}

export interface JobSetProjectModePayload {
  readonly mode: ConductorProjectMode;
}

export type { JobKind, JobStatus };
