import { userCancellationReason } from '#/utils/abort';
import { ErrorCodes, LioraError } from '#/errors/index';
import type { SessionWarning } from '@superliora/protocol';
import type {
  AddAdditionalDirPayload, AddAdditionalDirResult, AgentAPI, BeginCompactionPayload,
  CancelPayload, CancelShellCommandPayload, ConversationLoopStateData, DetachBackgroundPayload,
  EmptyPayload, GetBackgroundOutputPayload, GetBackgroundPayload, PromptPayload,
  RenameSessionPayload, RewindFilesPayload, RewindFilesResult, RunShellCommandPayload,
  SessionAPI, SetModelPayload, SetPermissionPayload, SetThinkingPayload, SteerPayload,
  StopBackgroundPayload, StartConversationLoopPayload, StopConversationLoopPayload,
  UndoHistoryPayload, UpdateSessionMetadataPayload,
  JobCancelPayload, JobCreateBatchPayload, JobCreatePayload, JobGcWorktreesPayload,
  JobInboxPayload, JobIdPayload, JobMergePayload, JobPushPayload, JobPreviewSplitPayload,
  JobResumePayload, JobAdoptPayload, JobLandChoicePayload, JobRenamePayload,
  JobSetProjectModePayload, JobSteerPayload, JobWorkspaceCatalogPayload,
} from '#/rpc';
import type { PromisableMethods } from '#/utils/types';

import { buildSessionOAuthStatus } from '../runtime/session-oauth-status';
import { findWorkspaceSession } from '#/tools/builtin/job/job-workspace-catalog';
import {
  importWorkerHomedir,
  siblingWorkerHomedir,
} from '#/tools/builtin/job/job-workspace-bind';
import type { Session, SessionMeta } from '.';
import { buildSessionTrace } from './trace';
import { promptMetadataTextFromPayload } from './prompt-metadata';
import { toConversationLoopStateData, updatePromptMetadata } from './rpc-prompt-handlers';
import { applySandboxPolicyToAgents, sandboxPolicyAtLeast, type SandboxPolicyUpdate } from './sandbox-policy-update';

type AgentScopedPayload<T> = T & { agentId: string };

const priorityAdmissions = new WeakMap<Session, Promise<void>>();

export class SessionAPIImpl implements PromisableMethods<SessionAPI> {
  constructor(protected readonly session: Session) {}

  async renameSession(payload: RenameSessionPayload): Promise<void> {
    const title = payload.title.trim();
    if (title.length === 0) {
      throw new LioraError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    this.session.metadata = {
      ...this.session.metadata,
      title,
      isCustomTitle: true,
      updatedAt: new Date().toISOString(),
    };
    await this.session.writeMetadata();
  }

  async updateSessionMetadata(payload: UpdateSessionMetadataPayload): Promise<void> {
    // Untyped wire callers can still send it; the patch type already excludes it.
    if ((payload.metadata as { workerAncestry?: unknown }).workerAncestry !== undefined) {
      throw new Error('Worker ancestry is host-owned session admission metadata');
    }
    const nextCustom =
      payload.metadata.custom === undefined
        ? this.session.metadata.custom
        : { ...this.session.metadata.custom, ...payload.metadata.custom };
    this.session.metadata = {
      ...this.session.metadata,
      ...payload.metadata,
      custom: nextCustom,
      agents: this.session.metadata.agents,
    };
    const changed = payload.metadata.custom;
    if (changed !== undefined && ('sandboxProfile' in changed || 'sandboxEnforcement' in changed)) {
      const profile = nextCustom['sandboxProfile'];
      const enforcement = nextCustom['sandboxEnforcement'];
      const policy: SandboxPolicyUpdate = sandboxPolicyAtLeast({
        profile: profile === 'off' || profile === 'workspace' || profile === 'read-only' ? profile : undefined,
        enforcement: enforcement === 'lexical' || enforcement === 'process' ? enforcement : undefined,
      }, this.session.options?.sandboxMinimum);
      nextCustom['sandboxProfile'] = policy.profile;
      nextCustom['sandboxEnforcement'] = policy.enforcement;
      if (policy.profile !== undefined || policy.enforcement !== undefined) {
        // Every existing child's gate is invalidated synchronously by this
        // fan-out before the first await. ACK only after all activations settle.
        await applySandboxPolicyToAgents(this.session.readyAgents(), policy);
      }
    }
    await this.session.writeMetadata();
  }

  getSessionMetadata(_payload: EmptyPayload): SessionMeta {
    return this.session.metadata;
  }


  getSessionWarnings(_payload: EmptyPayload): Promise<readonly SessionWarning[]> {
    return this.session.getSessionWarnings();
  }

  addAdditionalDir(payload: AddAdditionalDirPayload): Promise<AddAdditionalDirResult> {
    return this.session.addAdditionalDir(payload.path, payload.persist);
  }

  rewindFiles(payload: RewindFilesPayload): Promise<RewindFilesResult> {
    return this.session.rewindFiles({ turnId: payload.turnId });
  }

  startConversationLoop(payload: StartConversationLoopPayload): ConversationLoopStateData {
    return toConversationLoopStateData(
      this.session.startConversationLoop({
        prompt: payload.prompt,
        intervalMs: payload.intervalMs,
        maxIterations: payload.maxIterations,
        expiresAt: payload.expiresAt,
      }),
    );
  }

  stopConversationLoop(payload: StopConversationLoopPayload): ConversationLoopStateData | undefined {
    const state = this.session.stopConversationLoop(payload.loopId);
    return state === undefined ? undefined : toConversationLoopStateData(state);
  }

  listConversationLoops(_payload: EmptyPayload): readonly ConversationLoopStateData[] {
    return this.session.listConversationLoops().map(toConversationLoopStateData);
  }

  async prompt({ agentId, ...payload }: AgentScopedPayload<PromptPayload>) {
    if (agentId !== 'main' || this.session.options.role !== 'interactive-conductor') {
      if (agentId === 'main') {
        await updatePromptMetadata(this.session, promptMetadataTextFromPayload(payload));
      }
      return (await this.getAgent(agentId)).prompt(payload);
    }

    const previous = priorityAdmissions.get(this.session) ?? Promise.resolve();
    const admission = previous.catch(() => undefined).then(async () => {
      const agent = await this.session.ensureAgentResumed(agentId);
      this.session.getSubagentHost(agentId);
      if (agent.turn.hasActiveTurn) {
        const settled = agent.turn.waitForCurrentTurn();
        // Abort only this inference/tool-turn owner. The harness-owned
        // independent coordinator and its accepted sessions are untouched.
        agent.turn.cancel(undefined, userCancellationReason(), 'rpc');
        // Retain context ownership until local teardown finishes. Independent
        // worker admission/completion is deliberately NOT part of this join.
        await settled;
      }
      this.session.assertOpen();
      await updatePromptMetadata(this.session, promptMetadataTextFromPayload(payload));
      this.session.assertOpen();
      await agent.rpcMethods.prompt(payload);
    });
    priorityAdmissions.set(this.session, admission);
    try {
      await admission;
    } finally {
      if (priorityAdmissions.get(this.session) === admission) priorityAdmissions.delete(this.session);
    }
  }

  async steer({ agentId, ...payload }: AgentScopedPayload<SteerPayload>) {
    return (await this.getAgent(agentId)).steer(payload);
  }

  async runShellCommand({ agentId, ...payload }: AgentScopedPayload<RunShellCommandPayload>) {
    return (await this.getAgent(agentId)).runShellCommand(payload);
  }

  async cancelShellCommand({ agentId, ...payload }: AgentScopedPayload<CancelShellCommandPayload>) {
    return (await this.getAgent(agentId)).cancelShellCommand(payload);
  }

  async cancel({ agentId, ...payload }: AgentScopedPayload<CancelPayload>) {
    return (await this.getAgent(agentId)).cancel(payload);
  }

  async undoHistory({ agentId, ...payload }: AgentScopedPayload<UndoHistoryPayload>) {
    return (await this.getAgent(agentId)).undoHistory(payload);
  }

  async setModel({ agentId, ...payload }: AgentScopedPayload<SetModelPayload>) {
    return (await this.getAgent(agentId)).setModel(payload);
  }

  async setThinking({ agentId, ...payload }: AgentScopedPayload<SetThinkingPayload>) {
    return (await this.getAgent(agentId)).setThinking(payload);
  }

  async setPermission({ agentId, ...payload }: AgentScopedPayload<SetPermissionPayload>) {
    return (await this.getAgent(agentId)).setPermission(payload);
  }

  async getModel({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getModel(payload);
  }


  async beginCompaction({ agentId, ...payload }: AgentScopedPayload<BeginCompactionPayload>) {
    return (await this.getAgent(agentId)).beginCompaction(payload);
  }

  async cancelCompaction({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelCompaction(payload);
  }


  async stopBackground({ agentId, ...payload }: AgentScopedPayload<StopBackgroundPayload>) {
    return (await this.getAgent(agentId)).stopBackground(payload);
  }

  async detachBackground({ agentId, ...payload }: AgentScopedPayload<DetachBackgroundPayload>) {
    return (await this.getAgent(agentId)).detachBackground(payload);
  }

  async clearContext({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).clearContext(payload);
  }


  async startBtw({ agentId }: AgentScopedPayload<EmptyPayload>): Promise<string> {
    return this.session.getSubagentHost(agentId).startBtw();
  }


  async jobList({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).jobList(payload);
  }

  async jobInspect({ agentId, ...payload }: AgentScopedPayload<JobIdPayload>) {
    return (await this.getAgent(agentId)).jobInspect(payload);
  }

  async jobInbox({ agentId, ...payload }: AgentScopedPayload<JobInboxPayload>) {
    return (await this.getAgent(agentId)).jobInbox(payload);
  }

  async jobSteer({ agentId, ...payload }: AgentScopedPayload<JobSteerPayload>) {
    return (await this.getAgent(agentId)).jobSteer(payload);
  }

  async jobCancel({ agentId, ...payload }: AgentScopedPayload<JobCancelPayload>) {
    return (await this.getAgent(agentId)).jobCancel(payload);
  }

  async jobPause({ agentId, ...payload }: AgentScopedPayload<JobCancelPayload>) {
    return (await this.getAgent(agentId)).jobPause(payload);
  }

  async jobResume({ agentId, ...payload }: AgentScopedPayload<JobResumePayload>) {
    return (await this.getAgent(agentId)).jobResume(payload);
  }

  async jobCreate({ agentId, ...payload }: AgentScopedPayload<JobCreatePayload>) {
    return (await this.getAgent(agentId)).jobCreate(payload);
  }

  async jobCreateBatch({ agentId, ...payload }: AgentScopedPayload<JobCreateBatchPayload>) {
    return (await this.getAgent(agentId)).jobCreateBatch(payload);
  }

  async jobMerge({ agentId, ...payload }: AgentScopedPayload<JobMergePayload>) {
    return (await this.getAgent(agentId)).jobMerge(payload);
  }

  async jobPush({ agentId, ...payload }: AgentScopedPayload<JobPushPayload>) {
    return (await this.getAgent(agentId)).jobPush(payload);
  }

  async jobPreviewSplit({ agentId, ...payload }: AgentScopedPayload<JobPreviewSplitPayload>) {
    return (await this.getAgent(agentId)).jobPreviewSplit(payload);
  }

  async jobGcWorktrees({ agentId, ...payload }: AgentScopedPayload<JobGcWorktreesPayload>) {
    return (await this.getAgent(agentId)).jobGcWorktrees(payload);
  }

  async jobSetProjectMode({ agentId, ...payload }: AgentScopedPayload<JobSetProjectModePayload>) {
    return (await this.getAgent(agentId)).jobSetProjectMode(payload);
  }

  async jobWorkspaceCatalog({
    agentId,
    ...payload
  }: AgentScopedPayload<JobWorkspaceCatalogPayload>) {
    return (await this.getAgent(agentId)).jobWorkspaceCatalog(payload);
  }

  async jobAdoptWorkspace({ agentId, ...payload }: AgentScopedPayload<JobAdoptPayload>) {
    const agent = await this.getAgent(agentId);
    this.importWorkspaceWorkerIfPresent(this.session.options.kaos.getcwd(), payload.jobId);
    return agent.jobAdoptWorkspace(payload);
  }

  async jobArchiveWorkspace({ agentId, ...payload }: AgentScopedPayload<JobIdPayload>) {
    return (await this.getAgent(agentId)).jobArchiveWorkspace(payload);
  }

  async jobRenameWorkspace({ agentId, ...payload }: AgentScopedPayload<JobRenamePayload>) {
    return (await this.getAgent(agentId)).jobRenameWorkspace(payload);
  }

  async jobLandChoice({ agentId, ...payload }: AgentScopedPayload<JobLandChoicePayload>) {
    return (await this.getAgent(agentId)).jobLandChoice(payload);
  }

  private importWorkspaceWorkerIfPresent(workDir: string | undefined, idOrName: string): void {
    if (workDir === undefined || workDir.trim().length === 0) return;
    const entry = findWorkspaceSession(workDir, idOrName);
    const workerId = entry?.workerResumeAgentId?.trim();
    if (entry === undefined || workerId === undefined || workerId.length === 0) return;
    const source =
      entry.workerHomedir?.trim() ||
      (entry.sourceAgentDir !== undefined && entry.sourceAgentDir.length > 0
        ? siblingWorkerHomedir(entry.sourceAgentDir, workerId)
        : undefined);
    if (source === undefined || source.length === 0) return;
    const imported = importWorkerHomedir({
      sessionHomedir: this.session.options.homedir,
      workerId,
      sourceHomedir: source,
    });
    if (imported.ok) {
      this.session.registerImportedSubagent(workerId, imported.dest);
    }
  }

  async getBackgroundOutput({
    agentId,
    ...payload
  }: AgentScopedPayload<GetBackgroundOutputPayload>) {
    return (await this.getAgent(agentId)).getBackgroundOutput(payload);
  }

  async getContext({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getContext(payload);
  }

  async getContextComposition({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getContextComposition(payload);
  }


  async getSessionTrace({ agentId }: AgentScopedPayload<EmptyPayload>) {
    const agent = await this.session.ensureAgentResumed(agentId);
    const context = agent.context.data();
    const records = await agent.records.readAll();
    return buildSessionTrace({
      sessionId: this.session.options.id ?? '',
      agentId,
      context,
      records,
    });
  }

  async getConfig({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getConfig(payload);
  }

  async getPermission({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPermission(payload);
  }

  async getCircuitBreakers({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getCircuitBreakers(payload);
  }

  async getCacheFrozen({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getCacheFrozen(payload);
  }

  async getCacheFreezeViolations({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getCacheFreezeViolations(payload);
  }

  async getParallelToolsStatus({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getParallelToolsStatus(payload);
  }

  async getOAuthStatus({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    const config = this.session.options.config;
    const homeDir = this.session.options.kimiHomeDir;
    if (config === undefined || homeDir === undefined) {
      return undefined;
    }
    const agentConfig = await (await this.getAgent(agentId)).getConfig(payload);
    return buildSessionOAuthStatus({
      config,
      homeDir,
      modelAlias: agentConfig.modelAlias,
    });
  }


  async getUsage({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getUsage(payload);
  }

  async getProviderRouteStatus({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getProviderRouteStatus(payload);
  }


  async resetProviderRouteStatus({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).resetProviderRouteStatus(payload);
  }


  async getBackground({ agentId, ...payload }: AgentScopedPayload<GetBackgroundPayload>) {
    return (await this.getAgent(agentId)).getBackground(payload);
  }


  private async getAgent(agentId: string): Promise<PromisableMethods<AgentAPI>> {
    const agent = await this.session.ensureAgentResumed(agentId);
    this.session.getSubagentHost(agentId);
    return agent.rpcMethods;
  }
}
