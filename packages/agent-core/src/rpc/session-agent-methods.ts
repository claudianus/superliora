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

export function getPlan(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
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

export function listSkills(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): Promise<readonly SkillSummary[]> {
  return context.sessionApi(sessionId).listSkills(payload);
}

export function listPluginCommands(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): readonly PluginCommandDef[] {
  return context.sessionApi(sessionId).listPluginCommands(payload);
}

export function searchSkills(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<SearchSkillsPayload>): Promise<readonly SkillSearchResult[]> {
  return context.sessionApi(sessionId).searchSkills(payload);
}

export function listMcpServers(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): readonly McpServerInfo[] {
  return context.sessionApi(sessionId).listMcpServers(payload);
}

export function getMcpStartupMetrics(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): Promise<McpStartupMetrics> {
  return context.sessionApi(sessionId).getMcpStartupMetrics(payload);
}

export function reconnectMcpServer(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<ReconnectMcpServerPayload>): Promise<void> {
  return context.sessionApi(sessionId).reconnectMcpServer(payload);
}

export function generateAgentsMd(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<void> {
  return context.sessionApi(sessionId).generateAgentsMd(payload);
}

export function getSessionWarnings(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<readonly SessionWarning[]> {
  return context.sessionApi(sessionId).getSessionWarnings(payload);
}

export function addAdditionalDir(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<AddAdditionalDirPayload>): Promise<AddAdditionalDirResult> {
  return context.requireSession(sessionId).addAdditionalDir(payload.path, payload.persist);
}

export function rewindFiles(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<RewindFilesPayload>): Promise<RewindFilesResult> {
  return context.sessionApi(sessionId).rewindFiles(payload);
}

export function startConversationLoop(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<StartConversationLoopPayload>): Promise<ConversationLoopStateData> {
  return Promise.resolve(context.sessionApi(sessionId).startConversationLoop(payload));
}

export function stopConversationLoop(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<StopConversationLoopPayload>): Promise<ConversationLoopStateData | undefined> {
  return Promise.resolve(context.sessionApi(sessionId).stopConversationLoop(payload));
}

export function listConversationLoops(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): Promise<readonly ConversationLoopStateData[]> {
  return Promise.resolve(context.sessionApi(sessionId).listConversationLoops(payload));
}

export function startBtw(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
): Promise<string> {
  return context.sessionApi(sessionId).startBtw(payload);
}

export function createGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<CreateGoalPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).createGoal(payload));
}

export function getGoal(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
): Promise<GoalToolResult> {
  return Promise.resolve(context.sessionApi(sessionId).getGoal(payload));
}

export function pauseGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).pauseGoal(payload));
}

export function resumeGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).resumeGoal(payload));
}

export function cancelGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).cancelGoal(payload));
}

export function createUltraworkRun(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<CreateUltraworkRunPayload>): Promise<UltraworkRunSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).createUltraworkRun(payload));
}

export function getUltraworkRun(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<UltraworkRunSnapshot | null> {
  return Promise.resolve(context.sessionApi(sessionId).getUltraworkRun(payload));
}

export function pauseUltrawork(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<PauseUltraworkPayload>): Promise<UltraworkRunSnapshot | null> {
  return Promise.resolve(context.sessionApi(sessionId).pauseUltrawork(payload));
}

export function swarmRestaff(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<SwarmRestaffPayload>): Promise<boolean> {
  return Promise.resolve(context.sessionApi(sessionId).swarmRestaff(payload));
}

export function resumeUltrawork(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<ResumeUltraworkPayloadResult | null> {
  return Promise.resolve(context.sessionApi(sessionId).resumeUltrawork(payload));
}

export function cancelUltrawork(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<CancelUltraworkPayload>): Promise<UltraworkRunSnapshot | null> {
  return Promise.resolve(context.sessionApi(sessionId).cancelUltrawork(payload));
}
export async function classifyUltraworkAutoActivation(
  context: SessionAgentMethodsContext,
  {
    sessionId,
    ...payload
  }: SessionAgentPayload<ClassifyUltraworkAutoActivationPayload>,
): Promise<UltraworkAutoActivationDecision> {
  return context.sessionApi(sessionId).classifyUltraworkAutoActivation(payload);
}

export async function classifyUltraworkObjectiveProfile(
  context: SessionAgentMethodsContext,
  {
    sessionId,
    ...payload
  }: SessionAgentPayload<ClassifyUltraworkObjectiveProfilePayload>,
): Promise<UltraworkObjectiveProfileDecision> {
  return context.sessionApi(sessionId).classifyUltraworkObjectiveProfile(payload);
}
