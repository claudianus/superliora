/**
 * Session-scoped agent RPC method bodies — extracted from core-impl.ts.
 *
 * Thin delegators from `LioraCore` session/agent RPC methods to
 * `SessionAPIImpl`. These take a `SessionAgentMethodsContext` view of
 * `LioraCore` instead of the whole class.
 */

import type { Session, SessionMeta } from '../session';
import type { SessionAPIImpl } from '../session/rpc';
import type { LioraConfig } from '../config';
import type { SessionWarning } from '@superliora/protocol';

import { buildSessionOAuthStatus } from '../runtime/session-oauth-status';

import type {
  ActivateSkillPayload,
  ActivatePluginCommandPayload,
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CancelShellCommandPayload,
  ClassifyUltraworkAutoActivationPayload,
  ClassifyUltraworkObjectiveProfilePayload,
  CancelUltraworkPayload,
  CreateGoalPayload,
  CreateUltraworkRunPayload,
  ConversationLoopStateData,
  DetachBackgroundPayload,
  DiagnoseContextOSPayload,
  EmptyPayload,
  EnterPlanPayload,
  EnterSwarmPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  GoalSnapshot,
  GoalToolResult,
  InlineCompletePayload,
  PromptIntelligenceCallOptions,
  McpServerInfo,
  McpStartupMetrics,
  PauseUltraworkPayload,
  PluginCommandDef,
  PromptPayload,
  ReconnectMcpServerPayload,
  RegisterToolPayload,
  ResumeUltraworkPayloadResult,
  RewindFilesPayload,
  RewindFilesResult,
  RunShellCommandPayload,
  SearchSkillsPayload,
  SetActiveToolsPayload,
  SetModelPayload,
  SetModelResult,
  SetPermissionPayload,
  SetOrchestratorModePayload,
  SetPremiumQualityPayload,
  SetThinkingPayload,
  SkillSearchResult,
  SkillSummary,
  StartConversationLoopPayload,
  SteerPayload,
  StopBackgroundPayload,
  StopConversationLoopPayload,
  SwarmRestaffPayload,
  UltraworkAutoActivationDecision,
  UltraworkObjectiveProfileDecision,
  UltraworkRunSnapshot,
  UndoHistoryPayload,
  UnregisterToolPayload,
  RenameSessionPayload,
  UpdateSessionMetadataPayload,
} from './core-api';

type AgentScopedPayload<T> = T & { readonly agentId: string };
type SessionScopedPayload<T> = T & { readonly sessionId: string };
type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;
type UpdateSessionMetadataRequest = SessionScopedPayload<UpdateSessionMetadataPayload>;

export interface SessionAgentMethodsContext {
  sessionApi(sessionId: string): SessionAPIImpl;
  requireSession(sessionId: string): Session;
  reloadProviderManager(): LioraConfig;
}

export function prompt(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<PromptPayload>) {
  return context.sessionApi(sessionId).prompt(payload);
}

export function runShellCommand(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<RunShellCommandPayload>) {
  return context.sessionApi(sessionId).runShellCommand(payload);
}

export function cancelShellCommand(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<CancelShellCommandPayload>) {
  return context.sessionApi(sessionId).cancelShellCommand(payload);
}

export function steer(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<SteerPayload>) {
  return context.sessionApi(sessionId).steer(payload);
}

export function cancel(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<CancelPayload>) {
  return context.sessionApi(sessionId).cancel(payload);
}

export function undoHistory(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<UndoHistoryPayload>) {
  return context.sessionApi(sessionId).undoHistory(payload);
}

export async function setModel(
  context: SessionAgentMethodsContext,
  {
    sessionId,
    ...payload
  }: SessionAgentPayload<SetModelPayload>,
): Promise<SetModelResult> {
  context.reloadProviderManager();
  return context.sessionApi(sessionId).setModel(payload);
}

export function setThinking(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<SetThinkingPayload>) {
  return context.sessionApi(sessionId).setThinking(payload);
}

export function setPermission(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<SetPermissionPayload>) {
  return context.sessionApi(sessionId).setPermission(payload);
}

export function getModel(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getModel(payload);
}

export function enterPlan(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EnterPlanPayload>) {
  return context.sessionApi(sessionId).enterPlan(payload);
}

export function cancelPlan(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<CancelPlanPayload>) {
  return context.sessionApi(sessionId).cancelPlan(payload);
}

export function clearPlan(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).clearPlan(payload);
}

export function enterSwarm(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EnterSwarmPayload>) {
  return context.sessionApi(sessionId).enterSwarm(payload);
}

export function exitSwarm(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).exitSwarm(payload);
}

export function getSwarmMode(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getSwarmMode(payload);
}

export function setPremiumQuality(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<SetPremiumQualityPayload>) {
  return context.sessionApi(sessionId).setPremiumQuality(payload);
}

export function getPremiumQuality(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getPremiumQuality(payload);
}

export function setOrchestratorMode(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<SetOrchestratorModePayload>) {
  return context.sessionApi(sessionId).setOrchestratorMode(payload);
}

export function getOrchestratorMode(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getOrchestratorMode(payload);
}

export function beginCompaction(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<BeginCompactionPayload>) {
  return context.sessionApi(sessionId).beginCompaction(payload);
}

export function cancelCompaction(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).cancelCompaction(payload);
}

export function registerTool(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<RegisterToolPayload>) {
  return context.sessionApi(sessionId).registerTool(payload);
}

export function unregisterTool(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<UnregisterToolPayload>) {
  return context.sessionApi(sessionId).unregisterTool(payload);
}

export function setActiveTools(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<SetActiveToolsPayload>) {
  return context.sessionApi(sessionId).setActiveTools(payload);
}

export function stopBackground(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<StopBackgroundPayload>) {
  return context.sessionApi(sessionId).stopBackground(payload);
}

export function detachBackground(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<DetachBackgroundPayload>) {
  return context.sessionApi(sessionId).detachBackground(payload);
}

export function clearContext(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).clearContext(payload);
}

export function activateSkill(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<ActivateSkillPayload>): Promise<void> {
  return context.sessionApi(sessionId).activateSkill(payload);
}

export function activatePluginCommand(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<ActivatePluginCommandPayload>): Promise<void> {
  return context.sessionApi(sessionId).activatePluginCommand(payload);
}

export function getBackgroundOutput(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<GetBackgroundOutputPayload>) {
  return context.sessionApi(sessionId).getBackgroundOutput(payload);
}

export function getContext(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getContext(payload);
}

export function getContextComposition(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getContextComposition(payload);
}

export function diagnoseContextOS(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<DiagnoseContextOSPayload>) {
  return context.sessionApi(sessionId).diagnoseContextOS(payload);
}

export function getSessionTrace(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getSessionTrace(payload);
}

export function getConfig(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getConfig(payload);
}

export function getPermission(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getPermission(payload);
}

export function getCircuitBreakers(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
) {
  return context.sessionApi(sessionId).getCircuitBreakers(payload);
}

export function getCacheFrozen(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
) {
  return context.sessionApi(sessionId).getCacheFrozen(payload);
}

export function getParallelToolsStatus(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
) {
  return context.sessionApi(sessionId).getParallelToolsStatus(payload);
}

export async function getOAuthStatus(
  context: SessionAgentMethodsContext & {
    readonly config: LioraConfig;
    readonly homeDir: string;
  },
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
) {
  const agentConfig = await context.sessionApi(sessionId).getConfig(payload);
  return buildSessionOAuthStatus({
    config: context.config,
    homeDir: context.homeDir,
    modelAlias: agentConfig.modelAlias,
  });
}

export function getPlan(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
) {
  return context.sessionApi(sessionId).getPlan(payload);
}

export function getUsage(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getUsage(payload);
}

export function getProviderRouteStatus(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getProviderRouteStatus(payload);
}

export function resetProviderRouteStatus(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).resetProviderRouteStatus(payload);
}

export function getTools(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
  return context.sessionApi(sessionId).getTools(payload);
}

export function getBackground(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<GetBackgroundPayload>) {
  return context.sessionApi(sessionId).getBackground(payload);
}

export function inlineComplete(
  context: SessionAgentMethodsContext,
  
  { sessionId, ...payload }: SessionAgentPayload<InlineCompletePayload>,
  options?: PromptIntelligenceCallOptions,
) {
  return context.sessionApi(sessionId).inlineComplete(payload, options);
}

export function suggestPrompts(
  context: SessionAgentMethodsContext,
  
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
  options?: PromptIntelligenceCallOptions,
) {
  return context.sessionApi(sessionId).suggestPrompts(payload, options);
}

export function updateSessionMetadata(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: UpdateSessionMetadataRequest): Promise<void> {
  return context.sessionApi(sessionId).updateSessionMetadata(payload);
}

export function getSessionMetadata(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): SessionMeta {
  return context.sessionApi(sessionId).getSessionMetadata(payload);
}


export {
  listSkills,
  getHookRegistry,
  listPluginCommands,
  searchSkills,
  listMcpServers,
  getMcpStartupMetrics,
  reconnectMcpServer,
  generateAgentsMd,
  getSessionWarnings,
} from './session-agent-methods-discovery';
export {
  addAdditionalDir,
  rewindFiles,
  startConversationLoop,
  stopConversationLoop,
  listConversationLoops,
  startBtw,
  createGoal,
  getGoal,
  pauseGoal,
  resumeGoal,
  cancelGoal,
  createUltraworkRun,
  getUltraworkRun,
  pauseUltrawork,
  swarmRestaff,
  resumeUltrawork,
  cancelUltrawork,
  classifyUltraworkAutoActivation,
  classifyUltraworkObjectiveProfile,
} from './session-agent-methods-goal-ultrawork';
