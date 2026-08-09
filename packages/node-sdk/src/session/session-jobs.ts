/**
 * Job RPC delegation for Session — Conductor UX v2 host control surface.
 */

import { SessionGoalsMixin } from '#/session/session-goals';
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
  JobResumeResult,
  JobSetProjectModeResult,
  JobSnapshot,
  JobStatus,
  SplitJobIntent,
} from '#/session/types';

export abstract class SessionJobsMixin extends SessionGoalsMixin {
  async jobList(): Promise<readonly JobSnapshot[]> {
    this.ensureOpen();
    return this.rpc.jobList({ sessionId: this.id });
  }

  async jobInspect(jobId: string): Promise<JobInspectResult | undefined> {
    this.ensureOpen();
    return this.rpc.jobInspect({ sessionId: this.id, jobId });
  }

  async jobInbox(input: { markRead?: boolean; limit?: number } = {}): Promise<JobInboxResult> {
    this.ensureOpen();
    return this.rpc.jobInbox({ sessionId: this.id, ...input });
  }

  async jobSteer(input: {
    jobId: string;
    message: string;
    status?: JobStatus;
  }): Promise<JobActionResult> {
    this.ensureOpen();
    return this.rpc.jobSteer({ sessionId: this.id, ...input });
  }

  async jobCancel(input: { jobId: string; reason?: string }): Promise<JobActionResult> {
    this.ensureOpen();
    return this.rpc.jobCancel({ sessionId: this.id, ...input });
  }

  async jobResume(input: { jobId?: string; answer?: string } = {}): Promise<JobResumeResult> {
    this.ensureOpen();
    return this.rpc.jobResume({ sessionId: this.id, ...input });
  }

  async jobCreate(input: JobCreateInput): Promise<JobCreateResult> {
    this.ensureOpen();
    return this.rpc.jobCreate({ sessionId: this.id, ...input });
  }

  async jobCreateBatch(jobs: readonly JobCreateInput[]): Promise<JobCreateResult> {
    this.ensureOpen();
    return this.rpc.jobCreateBatch({ sessionId: this.id, jobs });
  }

  async jobMerge(input: JobMergeInput): Promise<JobMergeResult> {
    this.ensureOpen();
    return this.rpc.jobMerge({ sessionId: this.id, ...input });
  }

  async jobPreviewSplit(text: string): Promise<readonly SplitJobIntent[]> {
    this.ensureOpen();
    return this.rpc.jobPreviewSplit({ sessionId: this.id, text });
  }

  async jobGcWorktrees(input: { dryRun?: boolean } = {}): Promise<JobGcWorktreesResult> {
    this.ensureOpen();
    return this.rpc.jobGcWorktrees({ sessionId: this.id, ...input });
  }

  async jobSetProjectMode(mode: ConductorProjectMode): Promise<JobSetProjectModeResult> {
    this.ensureOpen();
    return this.rpc.jobSetProjectMode({ sessionId: this.id, mode });
  }
}
