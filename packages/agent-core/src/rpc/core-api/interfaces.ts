import type { AgentConfigData } from '#/agent/config';
import type { AgentContextData, ContextComposition } from '#/agent/context';
import type { ContextOSRetrievalDiagnostics } from '#/agent/context-os';
import type { BackgroundTaskInfo } from '#/agent/background';
import type { GoalSnapshot, GoalToolResult } from '#/agent/goal';
import type { PermissionData } from '#/agent/permission';
import type { CircuitBreakerStatus, ProviderExtrasStatus } from '@superliora/protocol';
import type { PlanData } from '#/agent/plan';
import type { ToolInfo } from '#/agent/tool';
import type { LioraConfig } from '#/config';
import type { ExperimentalFeatureState } from '#/flags';
import type { ResumeSessionResult } from '#/rpc/resumed';
import type { SessionMeta } from '#/session';
import type {
  MemoryConsolidateResult,
  MemoryExportResult,
  MemoryImportResult,
  MemoryRecord,
  MemorySearchResult,
  MemoryStats,
} from '#/memory';
import type { SessionWarning } from '@superliora/protocol';

import type { ProviderRouteStatus, UsageStatus } from '../events';
import type { WithAgentId, WithSessionId } from '../types';
import type { SessionTrace } from './session-trace';
import type {
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  ArchiveSessionPayload,
  CloseSessionPayload,
  ConversationLoopStateData,
  CoreInfo,
  CreateSessionPayload,
  EmptyPayload,
  ExportSessionPayload,
  ExportSessionResult,
  ForkSessionPayload,
  ListSessionsPayload,
  ReloadSessionPayload,
  RenameSessionPayload,
  ResumeSessionPayload,
  RewindFilesPayload,
  RewindFilesResult,
  SessionSummary,
  StartConversationLoopPayload,
  StopConversationLoopPayload,
  UpdateSessionMetadataPayload,
} from './payloads-session';
import type {
  ActivatePluginCommandPayload,
  ActivateSkillPayload,
  GetPluginInfoPayload,
  InstallPluginPayload,
  McpServerInfo,
  McpStartupMetrics,
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  ReconnectMcpServerPayload,
  ReloadPluginsResult,
  RemovePluginPayload,
  SearchSkillsPayload,
  SetPluginEnabledPayload,
  SetPluginMcpServerEnabledPayload,
  HookRegistrySummary,
  SkillSearchResult,
  SkillSummary,
} from './payloads-plugins';
import type {
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CancelShellCommandPayload,
  CreateGoalPayload,
  DetachBackgroundPayload,
  DiagnoseContextOSPayload,
  EnterPlanPayload,
  EnterSwarmPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  InlineCompletePayload,
  InlineCompleteResult,
  PromptIntelligenceCallOptions,
  PromptPayload,
  RegisterToolPayload,
  RunShellCommandPayload,
  SetModelPayload,
  SetModelResult,
  SetPermissionPayload,
  SetPremiumQualityPayload,
  SetThinkingPayload,
  ShellCommandResult,
  SteerPayload,
  StopBackgroundPayload,
  SuggestPromptsResult,
  UndoHistoryPayload,
  UnregisterToolPayload,
  SetActiveToolsPayload,
} from './payloads-agent';
import type {
  CancelUltraworkPayload,
  ClassifyUltraworkAutoActivationPayload,
  ClassifyUltraworkObjectiveProfilePayload,
  CreateUltraworkRunPayload,
  PauseUltraworkPayload,
  ResumeUltraworkPayloadResult,
  SwarmRestaffPayload,
  UltraworkAutoActivationDecision,
  UltraworkObjectiveProfileDecision,
  UltraworkRunSnapshot,
} from './payloads-goal';
import type {
  ConfigDiagnostics,
  DeleteConfigFieldsPayload,
  GetKimiConfigPayload,
  RemoveKimiProviderPayload,
  SetKimiConfigPayload,
} from './payloads-config';
import type {
  MemoryCreatePayload,
  MemoryForgetPayload,
  MemoryGetPayload,
  MemoryImportPayload,
  MemoryListPayload,
  MemorySearchPayload,
  MemoryUpdatePayload,
} from './payloads-memory';

export interface AgentAPI {
  prompt: (payload: PromptPayload) => void;
  runShellCommand: (payload: RunShellCommandPayload) => Promise<ShellCommandResult>;
  cancelShellCommand: (payload: CancelShellCommandPayload) => void;
  steer: (payload: SteerPayload) => void;
  cancel: (payload: CancelPayload) => void;
  undoHistory: (payload: UndoHistoryPayload) => void;
  setThinking: (payload: SetThinkingPayload) => void;
  setPermission: (payload: SetPermissionPayload) => void;
  setModel: (payload: SetModelPayload) => SetModelResult;
  getModel: (payload: EmptyPayload) => string;
  enterPlan: (payload: EnterPlanPayload) => void;
  cancelPlan: (payload: CancelPlanPayload) => void;
  clearPlan: (payload: EmptyPayload) => void;
  enterSwarm: (payload: EnterSwarmPayload) => void;
  exitSwarm: (payload: EmptyPayload) => void;
  getSwarmMode: (payload: EmptyPayload) => boolean;
  setPremiumQuality: (payload: SetPremiumQualityPayload) => void;
  getPremiumQuality: (payload: EmptyPayload) => boolean;
  beginCompaction: (payload: BeginCompactionPayload) => void;
  cancelCompaction: (payload: EmptyPayload) => void;
  registerTool: (payload: RegisterToolPayload) => void;
  unregisterTool: (payload: UnregisterToolPayload) => void;
  setActiveTools: (payload: SetActiveToolsPayload) => void;
  stopBackground: (payload: StopBackgroundPayload) => void;
  detachBackground: (payload: DetachBackgroundPayload) => BackgroundTaskInfo | undefined;
  clearContext: (payload: EmptyPayload) => void;
  activateSkill: (payload: ActivateSkillPayload) => Promise<void>;
  activatePluginCommand: (payload: ActivatePluginCommandPayload) => Promise<void>;
  startBtw: (payload: EmptyPayload) => string;
  createGoal: (payload: CreateGoalPayload) => GoalSnapshot;
  getGoal: (payload: EmptyPayload) => GoalToolResult;
  pauseGoal: (payload: EmptyPayload) => GoalSnapshot;
  resumeGoal: (payload: EmptyPayload) => GoalSnapshot;
  cancelGoal: (payload: EmptyPayload) => GoalSnapshot;
  createUltraworkRun: (payload: CreateUltraworkRunPayload) => UltraworkRunSnapshot;
  getUltraworkRun: (payload: EmptyPayload) => UltraworkRunSnapshot | null;
  pauseUltrawork: (payload: PauseUltraworkPayload) => UltraworkRunSnapshot | null;
  resumeUltrawork: (payload: EmptyPayload) => ResumeUltraworkPayloadResult | null;
  cancelUltrawork: (payload: CancelUltraworkPayload) => UltraworkRunSnapshot | null;
  /** Force UltraSwarm restaff wave; returns false when no active run. */
  swarmRestaff: (payload: SwarmRestaffPayload) => boolean;
  classifyUltraworkAutoActivation: (
    payload: ClassifyUltraworkAutoActivationPayload,
  ) => Promise<UltraworkAutoActivationDecision>;
  classifyUltraworkObjectiveProfile: (
    payload: ClassifyUltraworkObjectiveProfilePayload,
  ) => Promise<UltraworkObjectiveProfileDecision>;
  getBackgroundOutput: (payload: GetBackgroundOutputPayload) => string;
  getContext: (payload: EmptyPayload) => AgentContextData;
  getContextComposition: (payload: EmptyPayload) => ContextComposition;
  diagnoseContextOS: (payload: DiagnoseContextOSPayload) => ContextOSRetrievalDiagnostics;
  getConfig: (payload: EmptyPayload) => AgentConfigData;
  getPermission: (payload: EmptyPayload) => PermissionData;
  getCircuitBreakers: (payload: EmptyPayload) => CircuitBreakerStatus | undefined;
  getCacheFrozen: (payload: EmptyPayload) => boolean;
  /** Loop22b: soft/hard tool-list drift count (session lifetime). */
  getCacheFreezeViolations: (payload: EmptyPayload) => number;
  getParallelToolsStatus: (payload: EmptyPayload) => {
    readonly parallelToolsInFlight: number;
    readonly maxParallelTools?: number;
  };
  getOAuthStatus: (payload: EmptyPayload) => Promise<
    | {
        readonly poolSize?: number;
        readonly nextRefreshAtMs?: number;
      }
    | undefined
  >;
  getPlan: (payload: EmptyPayload) => PlanData;
  getUsage: (payload: EmptyPayload) => UsageStatus;
  getProviderRouteStatus: (payload: EmptyPayload) => ProviderRouteStatus | null;
  /** Provider-extras harness status (detected services, search cascade, media routing). */
  getProviderExtrasStatus: (payload: EmptyPayload) => ProviderExtrasStatus;
  resetProviderRouteStatus: (payload: EmptyPayload) => ProviderRouteStatus | null;
  getTools: (payload: EmptyPayload) => readonly ToolInfo[];
  getBackground: (payload: GetBackgroundPayload) => readonly BackgroundTaskInfo[];
  inlineComplete: (
    payload: InlineCompletePayload,
    options?: PromptIntelligenceCallOptions,
  ) => Promise<InlineCompleteResult>;
  suggestPrompts: (
    payload: EmptyPayload,
    options?: PromptIntelligenceCallOptions,
  ) => Promise<SuggestPromptsResult>;
}

type AgentAPIWithId = WithAgentId<AgentAPI>;

export interface SessionAPI extends AgentAPIWithId {
  renameSession: (payload: RenameSessionPayload) => void;
  updateSessionMetadata: (payload: UpdateSessionMetadataPayload) => void;
  getSessionMetadata: (payload: EmptyPayload) => SessionMeta;
  listSkills: (payload: EmptyPayload) => readonly SkillSummary[];
  getHookRegistry: (payload: EmptyPayload) => HookRegistrySummary;
  searchSkills: (payload: SearchSkillsPayload) => readonly SkillSearchResult[];
  listPluginCommands: (payload: EmptyPayload) => readonly PluginCommandDef[];
  listMcpServers: (payload: EmptyPayload) => readonly McpServerInfo[];
  getMcpStartupMetrics: (payload: EmptyPayload) => McpStartupMetrics;
  reconnectMcpServer: (payload: ReconnectMcpServerPayload) => void;
  generateAgentsMd: (payload: EmptyPayload) => void;
  getSessionWarnings: (payload: EmptyPayload) => readonly SessionWarning[];
  addAdditionalDir: (payload: AddAdditionalDirPayload) => AddAdditionalDirResult;
  getSessionTrace: (payload: EmptyPayload & { readonly agentId: string }) => Promise<SessionTrace>;
  /**
   * Restore files mutated during a sealed turn. Does not rewrite conversation
   * history — pair with `undoHistory` when the transcript should also roll back.
   */
  rewindFiles: (payload: RewindFilesPayload) => RewindFilesResult;
  startConversationLoop: (payload: StartConversationLoopPayload) => ConversationLoopStateData;
  stopConversationLoop: (payload: StopConversationLoopPayload) => ConversationLoopStateData | undefined;
  listConversationLoops: (payload: EmptyPayload) => readonly ConversationLoopStateData[];
}

type SessionAPIWithId = WithSessionId<SessionAPI>;

export interface CoreAPI extends SessionAPIWithId {
  getCoreInfo: (payload: EmptyPayload) => CoreInfo;
  getExperimentalFeatures: (payload: EmptyPayload) => readonly ExperimentalFeatureState[];
  getKimiConfig: (payload: GetKimiConfigPayload) => LioraConfig;
  getConfigDiagnostics: (payload: EmptyPayload) => ConfigDiagnostics;
  setKimiConfig: (payload: SetKimiConfigPayload) => LioraConfig;
  removeKimiProvider: (payload: RemoveKimiProviderPayload) => LioraConfig;
  deleteConfigFields: (payload: DeleteConfigFieldsPayload) => LioraConfig;
  createSession: (payload: CreateSessionPayload) => SessionSummary;
  closeSession: (payload: CloseSessionPayload) => void;
  archiveSession: (payload: ArchiveSessionPayload) => void;
  resumeSession: (payload: ResumeSessionPayload) => ResumeSessionResult;
  reloadSession: (payload: ReloadSessionPayload) => ResumeSessionResult;
  forkSession: (payload: ForkSessionPayload) => ResumeSessionResult;
  listSessions: (payload: ListSessionsPayload) => readonly SessionSummary[];
  exportSession: (payload: ExportSessionPayload) => ExportSessionResult;
  listPlugins: (payload: EmptyPayload) => readonly PluginSummary[];
  installPlugin: (payload: InstallPluginPayload) => PluginSummary;
  setPluginEnabled: (payload: SetPluginEnabledPayload) => void;
  setPluginMcpServerEnabled: (payload: SetPluginMcpServerEnabledPayload) => void;
  removePlugin: (payload: RemovePluginPayload) => void;
  reloadPlugins: (payload: EmptyPayload) => ReloadPluginsResult;
  getPluginInfo: (payload: GetPluginInfoPayload) => PluginInfo;
  listPluginThemes: (payload: EmptyPayload) => readonly import('#/plugin/themes').PluginThemeDef[];
  memorySearch: (payload: MemorySearchPayload) => readonly MemorySearchResult[];
  memoryList: (payload: MemoryListPayload) => readonly MemoryRecord[];
  memoryGet: (payload: MemoryGetPayload) => MemoryRecord | undefined;
  memoryCreate: (payload: MemoryCreatePayload) => MemoryRecord;
  memoryUpdate: (payload: MemoryUpdatePayload) => MemoryRecord;
  memoryForget: (payload: MemoryForgetPayload) => boolean;
  memoryStats: (payload: EmptyPayload) => MemoryStats;
  memoryExport: (payload: MemoryListPayload) => MemoryExportResult;
  memoryImport: (payload: MemoryImportPayload) => MemoryImportResult;
  memoryConsolidate: (payload: EmptyPayload) => MemoryConsolidateResult;
}
