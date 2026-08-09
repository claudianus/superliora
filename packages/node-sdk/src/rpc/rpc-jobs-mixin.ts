/**
 * Job RPC delegation for `SDKRpcClientBase` — Conductor UX v2 host control surface.
 */

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

import type { SessionIdRpcInput } from './rpc-types';
import { SDKRpcClientGoalsMixin } from './rpc-goals-mixin';

export abstract class SDKRpcClientJobsMixin extends SDKRpcClientGoalsMixin {
  async jobList(input: SessionIdRpcInput): Promise<readonly JobSnapshot[]> {
    const rpc = await this.getRpc();
    return rpc.jobList({ sessionId: input.sessionId, agentId: this.interactiveAgentId });
  }

  async jobInspect(
    input: SessionIdRpcInput & { jobId: string },
  ): Promise<JobInspectResult | undefined> {
    const rpc = await this.getRpc();
    return rpc.jobInspect({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      jobId: input.jobId,
    });
  }

  async jobInbox(
    input: SessionIdRpcInput & { markRead?: boolean; limit?: number },
  ): Promise<JobInboxResult> {
    const rpc = await this.getRpc();
    return rpc.jobInbox({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      markRead: input.markRead,
      limit: input.limit,
    });
  }

  async jobSteer(
    input: SessionIdRpcInput & { jobId: string; message: string; status?: JobStatus },
  ): Promise<JobActionResult> {
    const rpc = await this.getRpc();
    return rpc.jobSteer({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      jobId: input.jobId,
      message: input.message,
      status: input.status,
    });
  }

  async jobCancel(
    input: SessionIdRpcInput & { jobId: string; reason?: string },
  ): Promise<JobActionResult> {
    const rpc = await this.getRpc();
    return rpc.jobCancel({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      jobId: input.jobId,
      reason: input.reason,
    });
  }

  async jobResume(
    input: SessionIdRpcInput & { jobId?: string; answer?: string },
  ): Promise<JobResumeResult> {
    const rpc = await this.getRpc();
    return rpc.jobResume({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      jobId: input.jobId,
      answer: input.answer,
    });
  }

  async jobCreate(input: SessionIdRpcInput & JobCreateInput): Promise<JobCreateResult> {
    const rpc = await this.getRpc();
    const { sessionId, ...payload } = input;
    return rpc.jobCreate({
      sessionId,
      agentId: this.interactiveAgentId,
      ...payload,
    });
  }

  async jobCreateBatch(
    input: SessionIdRpcInput & { jobs: readonly JobCreateInput[] },
  ): Promise<JobCreateResult> {
    const rpc = await this.getRpc();
    return rpc.jobCreateBatch({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      jobs: input.jobs,
    });
  }

  async jobMerge(input: SessionIdRpcInput & JobMergeInput): Promise<JobMergeResult> {
    const rpc = await this.getRpc();
    const { sessionId, ...payload } = input;
    return rpc.jobMerge({
      sessionId,
      agentId: this.interactiveAgentId,
      ...payload,
    });
  }

  async jobPreviewSplit(
    input: SessionIdRpcInput & { text: string },
  ): Promise<readonly SplitJobIntent[]> {
    const rpc = await this.getRpc();
    return rpc.jobPreviewSplit({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      text: input.text,
    });
  }

  async jobGcWorktrees(
    input: SessionIdRpcInput & { dryRun?: boolean },
  ): Promise<JobGcWorktreesResult> {
    const rpc = await this.getRpc();
    return rpc.jobGcWorktrees({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      dryRun: input.dryRun,
    });
  }

  async jobSetProjectMode(
    input: SessionIdRpcInput & { mode: ConductorProjectMode },
  ): Promise<JobSetProjectModeResult> {
    const rpc = await this.getRpc();
    return rpc.jobSetProjectMode({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      mode: input.mode,
    });
  }
}
