import {
  type AgentContextData,
  type ContextComposition,
  type ApprovalRequest,
  type ApprovalResponse,
  type CredentialRequest,
  type CredentialResponse,
  type Event,
  type QuestionRequest,
  type QuestionResult,
  type RPCCallOptions,
  type SessionTrace,
  type RuntimeDegradedEvent,
} from '@superliora/agent-core';

import type { ApprovalHandler, CredentialHandler, QuestionHandler } from '#/session/events';
import { buildSessionStatus } from '#/rpc/rpc-helpers';
import { SdkEventBridge, type QuestionAttention } from './rpc-event-bridge';
import { SDKRpcClientBackgroundMixin } from './rpc-background-mixin';
import type {
  AddAdditionalDirInput,
  AddAdditionalDirResult,
  ConfigDiagnostics,
  DeleteConfigFieldPath,
  GetConfigOptions,
  LioraConfig,
  LioraConfigPatch,
  ProviderRouteStatus,
  CompactOptions,
  SessionStatus,
  SessionUsage,
  Unsubscribe,
} from '#/session/types';
import {
  type CancelSessionRpcInput,
  type ConversationLoopState,
  type RunShellCommandRpcInput,
  type RunShellCommandRpcResult,
  type SessionIdRpcInput,
  type SessionPromptRpcInput,
  type SetSessionModelRpcInput,
  type SetSessionModelRpcResult,
  type SetSessionPermissionRpcInput,
  type SetSessionThinkingRpcInput,
  type StartConversationLoopRpcInput,
  type StopConversationLoopRpcInput,
} from './rpc-types';

export type {
  CancelSessionRpcInput,
  ConversationLoopState,
  RunShellCommandRpcInput,
  RunShellCommandRpcResult,
  SessionIdRpcInput,
  SessionPromptRpcInput,
  SetSessionModelRpcInput,
  SetSessionModelRpcResult,
  SetSessionPermissionRpcInput,
  SetSessionThinkingRpcInput,
  StartConversationLoopRpcInput,
  StopConversationLoopRpcInput,
} from './rpc-types';

export { ClientAPI } from './rpc-client-api';

export abstract class SDKRpcClientBase extends SDKRpcClientBackgroundMixin {
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

  broadcastRuntimeDegraded(_event: RuntimeDegradedEvent): void {
    // Default no-op for transports without an in-process core.
  }

  async getConfig(input?: GetConfigOptions): Promise<LioraConfig> {
    const rpc = await this.getRpc();
    return rpc.getKimiConfig(input ?? {});
  }

  async getConfigDiagnostics(): Promise<ConfigDiagnostics> {
    const rpc = await this.getRpc();
    return rpc.getConfigDiagnostics({});
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


  async getStatus(input: SessionIdRpcInput): Promise<SessionStatus> {
    const rpc = await this.getRpc();
    const scoped = { sessionId: input.sessionId, agentId: this.interactiveAgentId };
    const [config, context, permission, usage, providerRouteStatus, circuitBreakers,
      cacheFrozen, cacheFreezeViolations, parallelTools, oauth] = await Promise.all([
      rpc.getConfig(scoped), rpc.getContext(scoped), rpc.getPermission(scoped),
      rpc.getUsage(scoped), rpc.getProviderRouteStatus(scoped), rpc.getCircuitBreakers(scoped),
      rpc.getCacheFrozen(scoped), rpc.getCacheFreezeViolations(scoped),
      rpc.getParallelToolsStatus(scoped), rpc.getOAuthStatus(scoped),
    ]);
    return buildSessionStatus({ config, context, permission, usage, providerRouteStatus,
      circuitBreakers, cacheFrozen, cacheFreezeViolations, parallelTools, oauth });
  }

  async resetProviderRouteStatus(input: SessionIdRpcInput): Promise<ProviderRouteStatus | null> {
    const rpc = await this.getRpc();
    return rpc.resetProviderRouteStatus({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }


  onEvent(listener: (event: Event) => void): Unsubscribe {
    return this.eventBridge.onEvent(listener);
  }

  onQuestionAttention(listener: (change: QuestionAttention) => void): Unsubscribe {
    return this.eventBridge.onQuestionAttention(listener);
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
    options?: RPCCallOptions,
    fallback?: QuestionHandler,
  ): Promise<QuestionResult> {
    return this.eventBridge.requestQuestion(request, options, fallback);
  }

  async requestCredential(
    request: CredentialRequest & { sessionId: string; agentId: string },
  ): Promise<CredentialResponse | null> {
    return this.eventBridge.requestCredential(request);
  }

}
