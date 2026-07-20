import type {
  ExportSessionManifest,
  ProviderRouteStatus,
  ResumeSessionResult,
  ShellEnvironment,
  TelemetryClient,
  TelemetryContextPatch,
  TelemetryProperties,
} from '@superliora/agent-core';
import type { Kaos } from '@superliora/kaos';
import type { KimiHostIdentity, OAuthRefreshOutcome } from '@superliora/oauth';
import type { ContentPart } from '@superliora/kosong';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type Unsubscribe = () => void;

export type {
  AgentReplayRecord,
  AgentBackgroundTaskInfo,
  BackgroundConfig,
  BackgroundTaskInfo,
  BackgroundTaskStatus,
  ConfigDiagnostics,
  ContextComposition,
  ContextCompositionSegment,
  ContextMessage,
  CouncilDecision,
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  ExportSessionManifest,
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
  LioraConfig,
  LioraConfigPatch,
  KnowledgePromotion,
  LoopControl,
  MemoryConsolidateResult,
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryRecord,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdateInput,
  McpServerInfo,
  McpStartupMetrics,
  ModelAlias,
  MoonshotServiceConfig,
  OAuthRef,
  PluginCommandDef,
  PluginGithubMetadata,
  PluginGithubRef,
  PluginInfo,
  PluginMcpServerInfo,
  PluginSource,
  PluginSummary,
  ProcessBackgroundTaskInfo,
  PromptOrigin,
  ProviderConfig,
  ProviderRouteStatus,
  ProviderType,
  QuestionBackgroundTaskInfo,
  ResearchBackend,
  ResearchEvidence,
  ResearchEvidencePack,
  ReloadSummary,
  ResumedAgentState,
  SessionTrace,
  SessionTraceCompleteness,
  SessionTraceEvent,
  ServicesConfig,
  ShellEnvironment,
  SkillSearchResult,
  SkillSummary,
  TeamPlan,
  ThinkingConfig,
  ToolInfo,
  UltraResearchRun,
  UltraworkRun,
  UltraworkRecoveryReport,
  ResumeUltraworkPayloadResult,
  UltraworkTraceEvent,
  VerificationResult,
  VerificationArtifact,
  WorkGraph,
  WorkGraphNode,
  SubagentLifecycleTraceEvent,
} from '@superliora/agent-core';

export type { KimiHostIdentity, OAuthRefreshOutcome };
export type { TelemetryClient, TelemetryContextPatch, TelemetryProperties };
export type { ContentPart, Role, ToolCall } from '@superliora/kosong';

export type PermissionMode = 'yolo' | 'manual' | 'auto';

export interface CreateGoalInput {
  readonly objective: string;
  readonly replace?: boolean;
  /** Whether this goal is standalone or part of Ultrawork orchestration. */
  readonly source?: 'standalone' | 'ultrawork';
}

export interface CreateUltraworkRunInput {
  readonly id: string;
  readonly objective: string;
  readonly source: 'manual' | 'auto' | 'shift-tab' | 'goal' | 'headless';
  readonly replaceGoal: boolean;
  readonly evidenceRoot: string;
  readonly workDir: string;
}
export interface ClassifyUltraworkAutoActivationInput {
  readonly text: string;
}

export interface UltraworkAutoActivationDecision {
  readonly activate: boolean;
  readonly confidence: number;
  readonly reason: string;
}
export interface ClassifyUltraworkObjectiveProfileInput {
  readonly text: string;
}

export interface UltraworkObjectiveProfileDecision {
  readonly visualSurface: boolean;
  readonly benchSurface: boolean;
  readonly premiumDensity: 'visual' | 'code';
  readonly lanes: readonly string[];
  readonly confidence: number;
  readonly reason: string;
  readonly source: 'llm' | 'fallback';
}

export interface PauseUltraworkInput {
  readonly reason?: string;
}

export interface CancelUltraworkInput {
  readonly reason?: string;
}

export type TextPromptPart = Extract<ContentPart, { type: 'text' }>;
export type PromptPart = Extract<ContentPart, { type: 'text' | 'image_url' | 'video_url' }>;

export type PromptInput = readonly PromptPart[];

export interface LioraHarnessOptions {
  readonly identity?: KimiHostIdentity | undefined;
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly autoLoadConfig?: boolean | undefined;
  readonly uiMode?: string;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly onOAuthRefresh?: ((outcome: OAuthRefreshOutcome) => void) | undefined;
  readonly sessionStartedProperties?: TelemetryProperties;
}

export interface CreateSessionOptions {
  readonly id?: string | undefined;
  readonly workDir: string;
  readonly model?: string | undefined;
  readonly thinking?: string | undefined;
  readonly permission?: PermissionMode | undefined;
  readonly planMode?: boolean;
  readonly metadata?: JsonObject | undefined;
  readonly kaos?: Kaos | undefined;
  readonly persistenceKaos?: Kaos | undefined;
  readonly additionalDirs?: readonly string[];
  readonly sessionStartedProperties?: TelemetryProperties;
  /**
   * Print-mode (`liora -p`) only: hold the main turn open while background
   * subagents are still running before the run exits.
   */
  readonly drainAgentTasksOnStop?: boolean;
}

export interface RenameSessionInput {
  readonly id: string;
  readonly title: string;
}

export interface ResumeSessionInput {
  readonly id: string;
  readonly kaos?: Kaos | undefined;
  readonly persistenceKaos?: Kaos | undefined;
  readonly additionalDirs?: readonly string[];
  readonly sessionStartedProperties?: TelemetryProperties;
}

export interface ReloadSessionInput extends ResumeSessionInput {
  readonly forcePluginSessionStartReminder?: boolean;
}

export interface AddAdditionalDirInput {
  readonly id: string;
  readonly path: string;
  readonly persist: boolean;
}

export interface AddAdditionalDirOptions {
  readonly persist: boolean;
}

export interface ForkSessionInput {
  readonly id: string;
  readonly forkId?: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
}

export interface ExportSessionInput {
  readonly id: string;
  readonly outputPath?: string | undefined;
  readonly includeGlobalLog?: boolean | undefined;
  /** Host version to record in the export manifest. */
  readonly version: string;
  /** How the CLI was installed (e.g. 'npm-global', 'native'). */
  readonly installSource?: string | undefined;
  readonly shellEnv?: ShellEnvironment | undefined;
}

export interface ExportSessionResult {
  readonly zipPath: string;
  readonly entries: readonly string[];
  readonly sessionDir: string;
  readonly manifest: ExportSessionManifest;
}

export interface ListSessionsOptions {
  readonly workDir?: string;
  readonly sessionId?: string;
}

export interface GetConfigOptions {
  readonly reload?: boolean | undefined;
}

export interface CompactOptions {
  readonly instruction?: string | undefined;
}

export interface ReloadSessionOptions {
  readonly forcePluginSessionStartReminder?: boolean;
}

export interface PlanInfo {
  readonly id: string;
  readonly content: string;
  readonly path: string;
}

export type SessionPlan = PlanInfo | null;

export interface TokenUsage {
  readonly inputOther: number;
  readonly output: number;
  readonly inputCacheRead: number;
  readonly inputCacheCreation: number;
}

export interface SessionUsage {
  readonly byModel?: Record<string, TokenUsage> | undefined;
  readonly currentTurn?: TokenUsage | undefined;
  readonly total?: TokenUsage | undefined;
}

export interface SessionStatus {
  readonly model?: string;
  readonly thinkingLevel: string;
  readonly permission: PermissionMode;
  readonly planMode: boolean;
  readonly swarmMode?: boolean | undefined;
  readonly premiumQualityMode?: boolean | undefined;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly contextUsage: number;
  readonly usage?: SessionUsage;
  readonly providerRouteStatus?: ProviderRouteStatus | null;
  /** Context OS continuity/evidence health when compacted pages exist. */
  readonly contextOS?: {
    readonly pageCount: number;
    readonly readyPageCount: number;
    readonly needsRehydrationPageCount: number;
    readonly atRiskPageCount: number;
    readonly missingEvidencePageCount: number;
    readonly evidenceIdRecallScore: number;
    readonly latestContinuityStatus: string;
  };
  /** Micro-compaction trigger dashboard when tool-result clearing has fired. */
  readonly microCompaction?: {
    readonly total: number;
    readonly lastTrigger: string | null;
    readonly lastContextUsageRatio: number | null;
    readonly byTrigger: Readonly<Record<string, number>>;
  };
  /** Auto-dream long-horizon memory consolidation when Liora Recall is enabled. */
  readonly autoDream?: {
    readonly enabled: boolean;
    readonly inFlight: boolean;
    readonly runs: number;
    readonly lastDreamAt: number | null;
    readonly lastExamined: number | null;
    readonly lastMerged: number | null;
    readonly minHours: number;
    readonly minActiveRecords: number;
  };
}

export interface SessionSummary {
  readonly id: string;
  readonly title?: string | undefined;
  readonly lastPrompt?: string;
  readonly workDir: string;
  readonly sessionDir: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived?: boolean | undefined;
  readonly metadata?: JsonObject | undefined;
  readonly additionalDirs?: readonly string[];
}

export interface AddAdditionalDirResult {
  readonly additionalDirs: readonly string[];
  readonly projectRoot: string;
  readonly configPath: string;
  readonly persisted: boolean;
}

export type ResumedSessionState = Pick<ResumeSessionResult, 'sessionMetadata' | 'agents' | 'warning'>;

export interface ResumedSessionSummary extends SessionSummary, ResumedSessionState { }
