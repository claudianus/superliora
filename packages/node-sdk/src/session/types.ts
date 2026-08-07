import type {
  ExportSessionManifest,
  ProviderExtrasStatus,
  ProviderRouteSelection,
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
  DeleteConfigFieldPath,
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
  InlineCompletePayload,
  InlineCompleteResult,
  LioraConfig,
  LioraConfigPatch,
  LoopControl,
  MemoryCreateInput,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryInspectResult,
  MemoryRecord,
  MemoryReflectInput,
  MemoryReflectResult,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryStats,
  MemoryUpdateInput,
  McpServerInfo,
  McpStartupMetrics,
  ModelAlias,
  MoonshotServiceConfig,
  OAuthRef,
  PersonaConfig,
  PluginCommandDef,
  PluginGithubMetadata,
  PluginGithubRef,
  PluginInfo,
  PluginMcpServerInfo,
  PluginSource,
  PluginSummary,
  PluginThemeDef,
  ProcessBackgroundTaskInfo,
  PromptOrigin,
  ProviderConfig,
  ProviderExtrasStatus,
  ProviderRouteSelection,
  ProviderRouteStatus,
  ProviderType,
  QuestionBackgroundTaskInfo,
  ReloadSummary,
  ResumedAgentState,
  SessionTrace,
  SessionTraceCompleteness,
  SessionTraceEvent,
  ServicesConfig,
  ShellEnvironment,
  SkillSearchResult,
  SkillSummary,
  HookRegistrySummary,
  SuggestPromptsResult,
  ThinkingConfig,
  ToolInfo,
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
  /** Shell command that must exit 0 before the goal may complete (autonomous gate). */
  readonly gateCommand?: string;
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
  /** Project root for `.superliora/plugins/` merge (defaults to cwd). */
  readonly projectDir?: string;
  /** Ephemeral plugin directories (`--plugin-dir`); session scope. */
  readonly pluginDirs?: readonly string[];
  /** Opt-in Claude channel MCP server names for inbound inject. */
  readonly channelServers?: readonly string[];
  /**
   * Resolve marketplace plugin id → install source for dependency auto-install.
   */
  readonly resolveMarketplaceSource?: (
    pluginId: string,
  ) => Promise<string | undefined> | string | undefined;
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
  /**
   * When true (or an options object), create a git worktree for the forked
   * session and use that path as the new session workDir.
   */
  readonly worktree?: boolean | { readonly name?: string; readonly baseRef?: string };
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

export interface RefineOptions {
  readonly scope?: 'local' | 'global' | undefined;
  readonly instructions?: string | undefined;
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
  readonly askMode: boolean;
  readonly premiumQualityMode?: boolean | undefined;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly contextUsage: number;
  /** Prompt-cache hit rate (0..1) from session usage accounting, when recorded. */
  readonly cacheHitRate?: number;
  /** Consecutive warm turns (turn-level hit rate ≥99% with enough input tokens). */
  readonly cacheWarmStreak?: number;
  /** CacheFreezeGuard mid-turn freeze when wired by agent-core. */
  readonly cacheFrozen?: boolean;
  /** Loop22b: soft/hard tool-list drift count (session lifetime). */
  readonly cacheFreezeViolations?: number;
  /** Same-turn independent tool_calls currently executing (ToolScheduler). */
  readonly parallelToolsInFlight?: number;
  /** Peak concurrent tool_calls this turn (ToolScheduler). */
  readonly maxParallelTools?: number;
  /** Permission interventions queued while waiting on host approval. */
  readonly pendingInterventions?: number;
  /** Queue entries older than 120s (visibility only; no auto-deny). */
  readonly staleInterventions?: number;
  /** Age in ms of the longest-waiting queued intervention (Ops/Never-Halt glance). */
  readonly oldestInterventionAgeMs?: number;
  /** Never-Halt circuit breaker registry snapshot when wired by agent-core. */
  readonly circuitBreakers?: {
    readonly closed: number;
    readonly open: number;
    readonly halfOpen: number;
    readonly lastTripReason?: string;
    readonly scopes?: ReadonlyArray<{
      readonly id: string;
      readonly state: string;
      readonly failures: number;
      readonly lastTripReason?: string;
    }>;
  };
  /** Loop-control role → model alias assignments; unset entries mean auto-inferred. */
  readonly roleModels?: {
    readonly compaction?: string;
    readonly completion?: string;
    readonly exploration?: string;
    readonly coding?: string;
    readonly planning?: string;
    readonly debugging?: string;
  };
  readonly usage?: SessionUsage;
  readonly providerRouteStatus?: ProviderRouteStatus | null;
  /** Provider-extras harness status (detected services, search cascade, media routing). */
  readonly extras?: ProviderExtrasStatus | undefined;
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
  /** Automatic long-horizon memory reflection when Liora Memory is enabled. */
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
  /** OAuth account pool + proactive refresh schedule when wired by agent-core. */
  readonly oauth?: {
    readonly poolSize?: number;
    readonly nextRefreshAtMs?: number;
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
