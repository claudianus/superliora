import {
  type AgentContextData,
  type ContextComposition,
  type ContextOSRetrievalDiagnostics,
  type ApprovalRequest,
  type ApprovalResponse,
  type CredentialRequest,
  type CredentialResponse,
  type Event,
  type ExperimentalFeatureState,
  type InlineCompleteResult,
  type QuestionRequest,
  type QuestionResult,
  type SuggestPromptsResult,
  type ToolCallRequest,
  type ToolCallResponse,
  type ToolInfo,
  type SwarmModeTrigger,
  type SessionTrace,
} from '@superliora/agent-core';
import type { Kaos } from '@superliora/kaos';

import type { ApprovalHandler, CredentialHandler, QuestionHandler } from '#/events';
import { buildSessionStatus } from '#/rpc-helpers';
import { SdkEventBridge } from './rpc-event-bridge';
import { SDKRpcClientPluginsMixin } from './rpc-plugins-mixin';
import type {
  AddAdditionalDirInput,
  AddAdditionalDirResult,
  BackgroundTaskInfo,
  ConfigDiagnostics,
  CreateSessionOptions,
  DeleteConfigFieldPath,
  ExportSessionInput,
  ExportSessionResult,
  ForkSessionInput,
  GetConfigOptions,
  LioraConfig,
  LioraConfigPatch,
  ListSessionsOptions,
  McpServerInfo,
  McpStartupMetrics,
  ProviderRouteStatus,
  CompactOptions,
  SessionPlan,
  SessionStatus,
  SessionUsage,
  RenameSessionInput,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
  SkillSearchResult,
  SkillSummary,
  Unsubscribe,
} from '#/types';
import {
  type ActivatePluginCommandRpcInput,
  type ActivateSkillRpcInput,
  type CancelSessionRpcInput,
  type ConversationLoopState,
  type InlineCompleteRpcInput,
  type ReconnectMcpServerRpcInput,
  type ReloadSessionRpcInput,
  type RewindFilesRpcResult,
  type RunShellCommandRpcInput,
  type RunShellCommandRpcResult,
  type SearchSkillsRpcInput,
  type SessionIdRpcInput,
  type SessionPromptRpcInput,
  type SetSessionModelRpcInput,
  type SetSessionModelRpcResult,
  type SetSessionOrchestratorModeRpcInput,
  type SetSessionPermissionRpcInput,
  type SetSessionPlanModeRpcInput,
  type SetSessionPremiumQualityRpcInput,
  type SetSessionSwarmModeRpcInput,
  type SetSessionThinkingRpcInput,
  type StartConversationLoopRpcInput,
  type StopConversationLoopRpcInput,
  type SuggestPromptsRpcInput,
} from './rpc-types';

export type {
  ActivatePluginCommandRpcInput,
  ActivateSkillRpcInput,
  CancelSessionRpcInput,
  ConversationLoopState,
  InlineCompleteRpcInput,
  ReconnectMcpServerRpcInput,
  ReloadSessionRpcInput,
  RewindFilesRpcResult,
  RunShellCommandRpcInput,
  RunShellCommandRpcResult,
  SearchSkillsRpcInput,
  SessionIdRpcInput,
  SessionPromptRpcInput,
  SetSessionModelRpcInput,
  SetSessionModelRpcResult,
  SetSessionOrchestratorModeRpcInput,
  SetSessionPermissionRpcInput,
  SetSessionPlanModeRpcInput,
  SetSessionPremiumQualityRpcInput,
  SetSessionSwarmModeRpcInput,
  SetSessionThinkingRpcInput,
  StartConversationLoopRpcInput,
  StopConversationLoopRpcInput,
  SuggestPromptsRpcInput,
} from './rpc-types';

export { ClientAPI } from './rpc-client-api';

export abstract class SDKRpcClientBase extends SDKRpcClientPluginsMixin {
  private readonly eventBridge = new SdkEventBridge();

  /**
   * Emergency synchronous flush of all in-process sessions' pending state to
   * disk (fsync'd). Only meaningful for in-process cores (e.g.
   * {@link SDKRpcClient}); a remote-transport client has no local sessions and
   * leaves this as a no-op. Called from crash paths (signal handlers,
   * `uncaughtExceptionMonitor`); never throws.
   */
  emergencyFlushSync(): void {
    // Default no-op for transports without an in-process core.
  }

  async createSession(input: CreateSessionOptions): Promise<SessionSummary> {
    const rpc = await this.getRpc();
    const { planMode, ...coreInput } = input;
    void planMode;
    return rpc.createSession(coreInput);
  }

  /**
   * Create a session with a custom execution environment (Kaos).
   *
   * The base implementation ignores `kaos` and `persistenceKaos` because
   * remote transports (e.g. WebSocket-backed RPC) cannot serialize a Kaos
   * instance across the wire. In-process transports ({@link SDKRpcClient})
   * override this to pass the overrides directly to the core.
   */
  async createSessionWithKaos(
    input: CreateSessionOptions,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<SessionSummary> {
    void kaos;
    void persistenceKaos;
    return this.createSession(input);
  }

  async resumeSession(input: ResumeSessionInput): Promise<ResumedSessionSummary> {
    const rpc = await this.getRpc();
    return rpc.resumeSession({ ...input, sessionId: input.id });
  }

  /**
   * Resume a session with a custom execution environment (Kaos).
   *
   * Same transport limitation as {@link createSessionWithKaos}: the base
   * implementation ignores `kaos` / `persistenceKaos`.
   */
  async resumeSessionWithKaos(
    input: ResumeSessionInput,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<ResumedSessionSummary> {
    void kaos;
    void persistenceKaos;
    return this.resumeSession(input);
  }

  async reloadSession(input: ReloadSessionRpcInput): Promise<ResumedSessionSummary> {
    const rpc = await this.getRpc();
    return rpc.reloadSession({
      sessionId: input.sessionId,
      forcePluginSessionStartReminder: input.forcePluginSessionStartReminder,
    });
  }

  async forkSession(input: ForkSessionInput): Promise<SessionSummary> {
    const rpc = await this.getRpc();
    return rpc.forkSession({
      sessionId: input.id,
      id: input.forkId,
      title: input.title,
      metadata: input.metadata,
      worktree: input.worktree,
    });
  }

  async closeSession(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.closeSession({ sessionId: input.sessionId });
  }

  async listSessions(input: ListSessionsOptions = {}): Promise<readonly SessionSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listSessions(input);
  }

  async renameSession(input: RenameSessionInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.renameSession({
      sessionId: input.id,
      title: input.title,
    });
  }

  async exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    const rpc = await this.getRpc();
    return rpc.exportSession({
      sessionId: input.id,
      outputPath: input.outputPath,
      includeGlobalLog: input.includeGlobalLog,
      version: input.version,
      installSource: input.installSource,
      shellEnv: input.shellEnv,
    });
  }

  async getConfig(input?: GetConfigOptions): Promise<LioraConfig> {
    const rpc = await this.getRpc();
    return rpc.getKimiConfig(input ?? {});
  }

  async getConfigDiagnostics(): Promise<ConfigDiagnostics> {
    const rpc = await this.getRpc();
    return rpc.getConfigDiagnostics({});
  }

  async getExperimentalFeatures(): Promise<readonly ExperimentalFeatureState[]> {
    const rpc = await this.getRpc();
    return rpc.getExperimentalFeatures({});
  }

  async setConfig(input: LioraConfigPatch): Promise<LioraConfig> {
    const rpc = await this.getRpc();
    return rpc.setKimiConfig(input);
  }

  async deleteConfigFields(paths: readonly DeleteConfigFieldPath[]): Promise<LioraConfig> {
    const rpc = await this.getRpc();
    return rpc.deleteConfigFields({ paths });
  }

  async removeProvider(providerId: string): Promise<LioraConfig> {
    const rpc = await this.getRpc();
    return rpc.removeKimiProvider({ providerId });
  }

  async prompt(input: SessionPromptRpcInput): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.prompt({
      sessionId: input.sessionId,
      agentId,
      input: input.input,
    });
  }

  async runShellCommand(input: RunShellCommandRpcInput): Promise<RunShellCommandRpcResult> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.runShellCommand({
      sessionId: input.sessionId,
      agentId,
      command: input.command,
      commandId: input.commandId,
    });
  }

  async cancelShellCommand(input: { sessionId: string; commandId: string }): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.cancelShellCommand({
      sessionId: input.sessionId,
      agentId,
      commandId: input.commandId,
    });
  }

  async steer(input: SessionPromptRpcInput): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.steer({
      sessionId: input.sessionId,
      agentId,
      input: input.input,
    });
  }

  async generateAgentsMd(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.generateAgentsMd({ sessionId: input.sessionId });
  }

  async getSessionWarnings(input: SessionIdRpcInput) {
    const rpc = await this.getRpc();
    return rpc.getSessionWarnings({ sessionId: input.sessionId });
  }

  async addAdditionalDir(input: AddAdditionalDirInput): Promise<AddAdditionalDirResult> {
    const rpc = await this.getRpc();
    return rpc.addAdditionalDir({ sessionId: input.id, path: input.path, persist: input.persist });
  }

  async startBtw(input: SessionIdRpcInput): Promise<string> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.startBtw({
      sessionId: input.sessionId,
      agentId,
    });
  }

  async cancel(input: CancelSessionRpcInput): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.cancel({
      sessionId: input.sessionId,
      agentId,
      source: input.source,
    });
  }

  async setModel(input: SetSessionModelRpcInput): Promise<SetSessionModelRpcResult> {
    const rpc = await this.getRpc();
    return rpc.setModel({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      model: input.model,
    });
  }

  async setThinking(input: SetSessionThinkingRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setThinking({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      level: input.level,
    });
  }

  async setPermission(input: SetSessionPermissionRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPermission({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      mode: input.mode,
    });
  }

  async setPremiumQuality(input: SetSessionPremiumQualityRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPremiumQuality({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      enabled: input.enabled,
    });
  }

  async setOrchestratorMode(input: SetSessionOrchestratorModeRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setOrchestratorMode({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      enabled: input.enabled,
    });
  }

  async setPlanMode(input: SetSessionPlanModeRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    if (!input.enabled) {
      return rpc.cancelPlan({
        sessionId: input.sessionId,
        agentId: this.interactiveAgentId,
      });
    }
    return rpc.enterPlan({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      ultra: input.ultra ? true : undefined,
      initialContext: input.initialContext,
      source: input.source,
    });
  }

  async setSwarmMode(input: SetSessionSwarmModeRpcInput): Promise<void> {
    if (input.enabled) return this.enterSwarmMode(input);
    return this.exitSwarmMode(input);
  }

  async swarm(input: SessionPromptRpcInput): Promise<void> {
    await this.enterSwarmMode({ sessionId: input.sessionId, trigger: 'task' });
    try {
      return await this.prompt(input);
    } catch (error) {
      // Roll back swarm mode so a failed prompt does not leave the session
      // stuck in swarm state.
      await this.exitSwarmMode({ sessionId: input.sessionId }).catch(() => {});
      throw error;
    }
  }

  private async enterSwarmMode(
    input: SessionIdRpcInput & { readonly trigger: SwarmModeTrigger },
  ): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.enterSwarm({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      trigger: input.trigger,
    });
  }

  private async exitSwarmMode(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.exitSwarm({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getPlan(input: SessionIdRpcInput): Promise<SessionPlan> {
    const rpc = await this.getRpc();
    return rpc.getPlan({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async clearPlan(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    await rpc.clearPlan({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async compact(input: SessionIdRpcInput & CompactOptions): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.beginCompaction({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
    });
  }

  async cancelCompaction(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.cancelCompaction({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async undoHistory(input: SessionIdRpcInput & { count: number }): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.undoHistory({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      count: input.count,
    });
  }

  async rewindFiles(input: SessionIdRpcInput & { turnId?: string | undefined }): Promise<RewindFilesRpcResult> {
    const rpc = await this.getRpc();
    return rpc.rewindFiles({
      sessionId: input.sessionId,
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
    });
  }

  async startConversationLoop(input: StartConversationLoopRpcInput): Promise<ConversationLoopState> {
    const rpc = await this.getRpc();
    return rpc.startConversationLoop({
      sessionId: input.sessionId,
      prompt: input.prompt,
      intervalMs: input.intervalMs,
      maxIterations: input.maxIterations,
      expiresAt: input.expiresAt,
    });
  }

  async stopConversationLoop(input: StopConversationLoopRpcInput): Promise<ConversationLoopState | undefined> {
    const rpc = await this.getRpc();
    return rpc.stopConversationLoop({
      sessionId: input.sessionId,
      ...(input.loopId !== undefined ? { loopId: input.loopId } : {}),
    });
  }

  async listConversationLoops(input: SessionIdRpcInput): Promise<readonly ConversationLoopState[]> {
    const rpc = await this.getRpc();
    return rpc.listConversationLoops({
      sessionId: input.sessionId,
    });
  }

  async getContext(input: SessionIdRpcInput): Promise<AgentContextData> {
    const rpc = await this.getRpc();
    return rpc.getContext({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getContextComposition(input: SessionIdRpcInput): Promise<ContextComposition> {
    const rpc = await this.getRpc();
    return rpc.getContextComposition({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async diagnoseContextOS(
    input: SessionIdRpcInput & { readonly query?: string; readonly limit?: number },
  ): Promise<ContextOSRetrievalDiagnostics> {
    const rpc = await this.getRpc();
    return rpc.diagnoseContextOS({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      query: input.query,
      limit: input.limit,
    });
  }

  async getSessionTrace(input: SessionIdRpcInput): Promise<SessionTrace> {
    const rpc = await this.getRpc();
    return rpc.getSessionTrace({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getUsage(input: SessionIdRpcInput): Promise<SessionUsage> {
    const rpc = await this.getRpc();
    return rpc.getUsage({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async inlineComplete(input: InlineCompleteRpcInput): Promise<InlineCompleteResult> {
    const rpc = await this.getRpc();
    return rpc.inlineComplete(
      {
        sessionId: input.sessionId,
        agentId: this.interactiveAgentId,
        text: input.text,
        cursorLine: input.cursorLine,
        cursorCol: input.cursorCol,
      },
      input.signal !== undefined ? { signal: input.signal } : undefined,
    );
  }

  async suggestPrompts(input: SuggestPromptsRpcInput): Promise<SuggestPromptsResult> {
    const rpc = await this.getRpc();
    return rpc.suggestPrompts(
      {
        sessionId: input.sessionId,
        agentId: this.interactiveAgentId,
      },
      input.signal !== undefined ? { signal: input.signal } : undefined,
    );
  }

  async getStatus(input: SessionIdRpcInput): Promise<SessionStatus> {
    const rpc = await this.getRpc();
    const agentId = this.interactiveAgentId;
    const scoped = { sessionId: input.sessionId, agentId };

    // Fetch all facets in parallel. Individual failures degrade to undefined
    // instead of failing the entire status query.
    const [config, context, permission, plan, swarmMode, premiumQualityMode, usage, providerRouteStatus] =
      await Promise.all([
        rpc.getConfig(scoped),
        rpc.getContext(scoped),
        rpc.getPermission(scoped),
        rpc.getPlan(scoped),
        rpc.getSwarmMode(scoped).catch(() => undefined),
        rpc.getPremiumQuality(scoped).catch(() => undefined),
        rpc.getUsage(scoped).catch(() => undefined),
        rpc.getProviderRouteStatus(scoped).catch(() => null),
      ]);
    return buildSessionStatus({
      config,
      context,
      permission,
      plan,
      swarmMode,
      premiumQualityMode,
      usage,
      providerRouteStatus,
    });
  }

  async resetProviderRouteStatus(input: SessionIdRpcInput): Promise<ProviderRouteStatus | null> {
    const rpc = await this.getRpc();
    return rpc.resetProviderRouteStatus({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async listSkills(input: SessionIdRpcInput): Promise<readonly SkillSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listSkills({ sessionId: input.sessionId });
  }

  async getTools(input: SessionIdRpcInput): Promise<readonly ToolInfo[]> {
    const rpc = await this.getRpc();
    return rpc.getTools({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async searchSkills(input: SearchSkillsRpcInput): Promise<readonly SkillSearchResult[]> {
    const rpc = await this.getRpc();
    return rpc.searchSkills({
      sessionId: input.sessionId,
      query: input.query,
      limit: input.limit,
    });
  }

  async listBackgroundTasks(
    input: SessionIdRpcInput & { activeOnly?: boolean; limit?: number },
  ): Promise<readonly BackgroundTaskInfo[]> {
    const rpc = await this.getRpc();
    return rpc.getBackground({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      activeOnly: input.activeOnly,
      limit: input.limit,
    });
  }

  async getBackgroundTaskOutput(
    input: SessionIdRpcInput & { taskId: string; tail?: number },
  ): Promise<string> {
    const rpc = await this.getRpc();
    return rpc.getBackgroundOutput({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      taskId: input.taskId,
      tail: input.tail,
    });
  }

  async stopBackgroundTask(
    input: SessionIdRpcInput & { taskId: string; reason?: string },
  ): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.stopBackground({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      taskId: input.taskId,
      reason: input.reason,
    });
  }

  async detachBackgroundTask(
    input: SessionIdRpcInput & { taskId: string },
  ): Promise<BackgroundTaskInfo | undefined> {
    const rpc = await this.getRpc();
    return rpc.detachBackground({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      taskId: input.taskId,
    });
  }

  async listMcpServers(input: SessionIdRpcInput): Promise<readonly McpServerInfo[]> {
    const rpc = await this.getRpc();
    return rpc.listMcpServers({ sessionId: input.sessionId });
  }

  async getMcpStartupMetrics(input: SessionIdRpcInput): Promise<McpStartupMetrics> {
    const rpc = await this.getRpc();
    return rpc.getMcpStartupMetrics({ sessionId: input.sessionId });
  }

  async reconnectMcpServer(input: ReconnectMcpServerRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.reconnectMcpServer({ sessionId: input.sessionId, name: input.name });
  }

  onEvent(listener: (event: Event) => void): Unsubscribe {
    return this.eventBridge.onEvent(listener);
  }

  receiveEvent(event: Event): void {
    this.eventBridge.receiveEvent(event);
  }

  setApprovalHandler(sessionId: string, handler: ApprovalHandler | undefined): void {
    this.eventBridge.setApprovalHandler(sessionId, handler);
  }

  setQuestionHandler(sessionId: string, handler: QuestionHandler | undefined): void {
    this.eventBridge.setQuestionHandler(sessionId, handler);
  }

  setCredentialHandler(sessionId: string, handler: CredentialHandler | undefined): void {
    this.eventBridge.setCredentialHandler(sessionId, handler);
  }

  clearSessionHandlers(sessionId: string): void {
    this.eventBridge.clearSessionHandlers(sessionId);
  }

  async requestApproval(
    request: ApprovalRequest & { sessionId: string; agentId: string },
  ): Promise<ApprovalResponse> {
    return this.eventBridge.requestApproval(request);
  }

  async requestQuestion(
    request: QuestionRequest & { sessionId: string; agentId: string },
  ): Promise<QuestionResult> {
    return this.eventBridge.requestQuestion(request);
  }

  async requestCredential(
    request: CredentialRequest & { sessionId: string; agentId: string },
  ): Promise<CredentialResponse | null> {
    return this.eventBridge.requestCredential(request);
  }

  async toolCall(request: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      output: `SDK custom tool calls are not supported: ${request.toolCallId}`,
      isError: true,
    };
  }
}
