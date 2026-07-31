import { ErrorCodes, LioraError } from '#/errors/index';
import type { AgentRecord } from '#/agent';
import type { SessionWarning } from '@superliora/protocol';
import type {
  ActivateSkillPayload,
  ActivatePluginCommandPayload,
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  AgentAPI,
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CancelShellCommandPayload,
  CancelUltraworkPayload,
  CreateGoalPayload,
  CreateUltraworkRunPayload,
  ClassifyUltraworkAutoActivationPayload,
  UltraworkAutoActivationDecision,
  ClassifyUltraworkObjectiveProfilePayload,
  UltraworkObjectiveProfileDecision,
  DetachBackgroundPayload,
  EmptyPayload,
  DiagnoseContextOSPayload,
  EnterPlanPayload,
  EnterSwarmPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  InlineCompletePayload,
  PromptIntelligenceCallOptions,
  PauseUltraworkPayload,
  SwarmRestaffPayload,
  McpServerInfo,
  McpStartupMetrics,
  PromptPayload,
  RunShellCommandPayload,
  ReconnectMcpServerPayload,
  RenameSessionPayload,
  RegisterToolPayload,
  SearchSkillsPayload,
  SessionAPI,
  SetActiveToolsPayload,
  SetModelPayload,
  SetPermissionPayload,
  SetPremiumQualityPayload,
  SetOrchestratorModePayload,
  SetThinkingPayload,
  SkillSummary,
  SkillSearchResult,
  PluginCommandDef,
  SteerPayload,
  StopBackgroundPayload,
  StartConversationLoopPayload,
  StopConversationLoopPayload,
  ConversationLoopStateData,
  RewindFilesPayload,
  RewindFilesResult,
  UndoHistoryPayload,
  UnregisterToolPayload,
  UpdateSessionMetadataPayload,
} from '#/rpc';
import type { PromisableMethods } from '#/utils/types';

import { buildSessionOAuthStatus } from '../runtime/session-oauth-status';
import type { Session, SessionMeta } from '.';
import { buildSessionTrace } from './trace';
import {
  promptMetadataTextFromPayload,
  promptMetadataTextFromPluginCommand,
  promptMetadataTextFromSkill,
} from './prompt-metadata';
import {
  maybeResumeInterruptedWorkInput,
  maybeResumeInterruptedWorkPrompt,
  maybeTransformNonVisionMedia,
  toConversationLoopStateData,
  updatePromptMetadata,
  updateResponseLanguagePreference,
} from './rpc-prompt-handlers';

type AgentScopedPayload<T> = T & { agentId: string };

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
    this.session.metadata = {
      ...this.session.metadata,
      ...payload.metadata,
      agents: this.session.metadata.agents,
    };
    await this.session.writeMetadata();
  }

  getSessionMetadata(_payload: EmptyPayload): SessionMeta {
    return this.session.metadata;
  }

  listSkills(_payload: EmptyPayload): Promise<readonly SkillSummary[]> {
    return this.session.listSkills();
  }

  getHookRegistry(_payload: EmptyPayload) {
    return this.session.getHookRegistry();
  }

  listPluginCommands(_payload: EmptyPayload): readonly PluginCommandDef[] {
    return this.session.listPluginCommands();
  }

  searchSkills(payload: SearchSkillsPayload): Promise<readonly SkillSearchResult[]> {
    return this.session.searchSkills(payload.query, payload.limit);
  }

  listMcpServers(_payload: EmptyPayload): readonly McpServerInfo[] {
    return this.session.mcp.list();
  }

  async getMcpStartupMetrics(_payload: EmptyPayload): Promise<McpStartupMetrics> {
    await this.session.mcp.waitForInitialLoad();
    return { durationMs: this.session.mcp.initialLoadDurationMs() };
  }

  async reconnectMcpServer(payload: ReconnectMcpServerPayload): Promise<void> {
    await this.session.mcp.reconnect(payload.name);
  }

  generateAgentsMd(_payload: EmptyPayload): Promise<void> {
    return this.session.generateAgentsMd();
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
    if (agentId === 'main') {
      await updatePromptMetadata(this.session, promptMetadataTextFromPayload(payload));
      await updateResponseLanguagePreference(this.session, payload.input);
      payload = await maybeResumeInterruptedWorkPrompt(this.session, agentId, payload);
    }
    const mediaTransformed = await maybeTransformNonVisionMedia(this.session, agentId, payload.input);
    if (mediaTransformed !== undefined) {
      payload = { ...payload, input: mediaTransformed };
    }
    return (await this.getAgent(agentId)).prompt(payload);
  }

  async steer({ agentId, ...payload }: AgentScopedPayload<SteerPayload>) {
    if (agentId === 'main') {
      await updateResponseLanguagePreference(this.session, payload.input);
      const transformed = await maybeResumeInterruptedWorkInput(this.session, agentId, payload.input);
      if (transformed !== undefined) {
        payload = { ...payload, input: transformed };
      }
    }
    const mediaTransformed = await maybeTransformNonVisionMedia(this.session, agentId, payload.input);
    if (mediaTransformed !== undefined) {
      payload = { ...payload, input: mediaTransformed };
    }
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

  async enterPlan({ agentId, ...payload }: AgentScopedPayload<EnterPlanPayload>) {
    return (await this.getAgent(agentId)).enterPlan(payload);
  }

  async cancelPlan({ agentId, ...payload }: AgentScopedPayload<CancelPlanPayload>) {
    return (await this.getAgent(agentId)).cancelPlan(payload);
  }

  async clearPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).clearPlan(payload);
  }

  async enterSwarm({ agentId, ...payload }: AgentScopedPayload<EnterSwarmPayload>) {
    return (await this.getAgent(agentId)).enterSwarm(payload);
  }

  async exitSwarm({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).exitSwarm(payload);
  }

  async getSwarmMode({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getSwarmMode(payload);
  }

  async setPremiumQuality({ agentId, ...payload }: AgentScopedPayload<SetPremiumQualityPayload>) {
    return (await this.getAgent(agentId)).setPremiumQuality(payload);
  }

  async getPremiumQuality({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPremiumQuality(payload);
  }

  async setOrchestratorMode({ agentId, ...payload }: AgentScopedPayload<SetOrchestratorModePayload>) {
    return (await this.getAgent(agentId)).setOrchestratorMode(payload);
  }

  async getOrchestratorMode({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getOrchestratorMode(payload);
  }

  async beginCompaction({ agentId, ...payload }: AgentScopedPayload<BeginCompactionPayload>) {
    return (await this.getAgent(agentId)).beginCompaction(payload);
  }

  async cancelCompaction({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelCompaction(payload);
  }

  async registerTool({ agentId, ...payload }: AgentScopedPayload<RegisterToolPayload>) {
    return (await this.getAgent(agentId)).registerTool(payload);
  }

  async unregisterTool({ agentId, ...payload }: AgentScopedPayload<UnregisterToolPayload>) {
    return (await this.getAgent(agentId)).unregisterTool(payload);
  }

  async setActiveTools({ agentId, ...payload }: AgentScopedPayload<SetActiveToolsPayload>) {
    return (await this.getAgent(agentId)).setActiveTools(payload);
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

  async activateSkill({ agentId, ...payload }: AgentScopedPayload<ActivateSkillPayload>) {
    await (await this.getAgent(agentId)).activateSkill(payload);
    if (agentId === 'main') {
      await updatePromptMetadata(this.session, promptMetadataTextFromSkill(payload));
    }
  }

  async activatePluginCommand({
    agentId,
    ...payload
  }: AgentScopedPayload<ActivatePluginCommandPayload>) {
    await (await this.getAgent(agentId)).activatePluginCommand(payload);
    if (agentId === 'main') {
      await updatePromptMetadata(this.session, promptMetadataTextFromPluginCommand(payload));
    }
  }

  async startBtw({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>): Promise<string> {
    return (await this.getAgent(agentId)).startBtw(payload);
  }

  async createGoal({ agentId, ...payload }: AgentScopedPayload<CreateGoalPayload>) {
    return (await this.getAgent(agentId)).createGoal(payload);
  }

  async getGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getGoal(payload);
  }

  async pauseGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).pauseGoal(payload);
  }

  async resumeGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).resumeGoal(payload);
  }

  async cancelGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelGoal(payload);
  }

  async createUltraworkRun({ agentId, ...payload }: AgentScopedPayload<CreateUltraworkRunPayload>) {
    return (await this.getAgent(agentId)).createUltraworkRun(payload);
  }

  async getUltraworkRun({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getUltraworkRun(payload);
  }

  async pauseUltrawork({ agentId, ...payload }: AgentScopedPayload<PauseUltraworkPayload>) {
    return (await this.getAgent(agentId)).pauseUltrawork(payload);
  }

  async swarmRestaff({ agentId, ...payload }: AgentScopedPayload<SwarmRestaffPayload>) {
    return (await this.getAgent(agentId)).swarmRestaff(payload);
  }

  async resumeUltrawork({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).resumeUltrawork(payload);
  }

  async cancelUltrawork({ agentId, ...payload }: AgentScopedPayload<CancelUltraworkPayload>) {
    return (await this.getAgent(agentId)).cancelUltrawork(payload);
  }
  async classifyUltraworkAutoActivation({
    agentId,
    ...payload
  }: AgentScopedPayload<ClassifyUltraworkAutoActivationPayload>): Promise<UltraworkAutoActivationDecision> {
    return (await this.getAgent(agentId)).classifyUltraworkAutoActivation(payload);
  }
  async classifyUltraworkObjectiveProfile({
    agentId,
    ...payload
  }: AgentScopedPayload<ClassifyUltraworkObjectiveProfilePayload>): Promise<UltraworkObjectiveProfileDecision> {
    return (await this.getAgent(agentId)).classifyUltraworkObjectiveProfile(payload);
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

  async diagnoseContextOS({
    agentId,
    ...payload
  }: AgentScopedPayload<DiagnoseContextOSPayload>) {
    return (await this.getAgent(agentId)).diagnoseContextOS(payload);
  }

  async getSessionTrace({ agentId }: AgentScopedPayload<EmptyPayload>) {
    const agent = await this.session.ensureAgentResumed(agentId);
    const context = agent.context.data();
    let records: readonly AgentRecord[] = [];
    try {
      records = [...(await agent.records.readAll())];
    } catch {
      records = [];
    }
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

  async getPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPlan(payload);
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

  async getTools({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getTools(payload);
  }

  async getBackground({ agentId, ...payload }: AgentScopedPayload<GetBackgroundPayload>) {
    return (await this.getAgent(agentId)).getBackground(payload);
  }

  async inlineComplete(
    { agentId, ...payload }: AgentScopedPayload<InlineCompletePayload>,
    options?: PromptIntelligenceCallOptions,
  ) {
    return (await this.getAgent(agentId)).inlineComplete(payload, options);
  }

  async suggestPrompts(
    { agentId, ...payload }: AgentScopedPayload<EmptyPayload>,
    options?: PromptIntelligenceCallOptions,
  ) {
    return (await this.getAgent(agentId)).suggestPrompts(payload, options);
  }

  private async getAgent(agentId: string): Promise<PromisableMethods<AgentAPI>> {
    const agent = await this.session.ensureAgentResumed(agentId);
    return agent.rpcMethods;
  }
}
