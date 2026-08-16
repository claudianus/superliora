import type {
  GoalChange,
  GoalSnapshot,
  ModelAlias,
  PermissionMode,
  ProviderRouteSelection,
  ProviderRouteStatus,
  ProviderConfig,
  PromptPart,
  ToolInputDisplay,
  ToolResultDisplay,
  AllProvidersUsageSnapshot,
} from '@superliora/sdk';

import type { TerminalRenderer } from '#/tui/renderer';

import type { ConductorJobsSnapshot } from './utils/job/job-strip';

import type {
  AppearancePreferences,
  ConductorPreferences,
  FooterPreferences,
  NotificationsConfig,
  OnboardingPreferences,
  UpgradePreferences,
} from './config';
import type { ConductorProjectMode } from './utils/job/intent-brief';
import type { PendingApproval, PendingQuestion } from './reverse-rpc/types';
import type { ColorToken, ThemeName } from './theme';

export type BannerDisplay = 'always' | 'once' | 'cooldown';

export interface BannerState {
  key: string;
  tag: string | null;
  mainText: string;
  subText: string | null;
  display: BannerDisplay;
  ttlHours?: number;
}

export interface AppState {
  model: string;
  workDir: string;
  additionalDirs: readonly string[];
  sessionId: string;
  permissionMode: PermissionMode;
  planMode: boolean;
  /** Ask mode: read/search/web only — edits and worker delegation are blocked. */
  askMode: boolean;
  /** Visual Quality mode: art direction, anti-slop visuals, skill routing, screenshot proof. */
  premiumQualityMode?: boolean;
  /**
   * Conductor Job desk state (meta-orchestrator). Populated when Job* tools
   * update the ledger, `job.*` events arrive, or after /jobs refresh;
   * optional until first job event. `jobs` / `inbox` feed the Job board view.
   */
  conductorJobs?: ConductorJobsSnapshot | null;
  /** Conductor UX v2 project mode (pool + Intent Composer defaults). */
  conductorProjectMode?: ConductorProjectMode;
  /** Transcript region: chat transcript vs Conductor Timeline. */
  transcriptRegionMode?: 'chat' | 'timeline';
  /** Persisted conductor prefs mirror (timeline defaulted flag, …). */
  conductor?: ConductorPreferences;
  /** 'bash' when the editor is in `!` shell-command mode. */
  inputMode: 'prompt' | 'bash';
  /** Whether thinking is enabled (true when {@link thinkingLevel} is not `'off'`). */
  thinking: boolean;
  /**
   * Session thinking effort level from the runtime (`off` | `on` | `low` |
   * `medium` | `high` | `xhigh` | `max`). Prefer this over the boolean
   * {@link thinking} flag when showing or applying effort.
   */
  thinkingLevel?: string;
  contextUsage: number;
  contextTokens: number;
  maxContextTokens: number;
  /**
   * Soft working-set policy from loopControl (Settings → Context / `/context`).
   * Used by the footer badge and `/usage` gauge. Missing until config sync.
   */
  workingSet?: {
    readonly maxWorkingSetTokens: number;
    readonly asyncWorkingSetTokens: number;
    readonly presetId?: 'balanced' | 'economy' | 'deep' | 'full_window';
  } | null;
  /** Accumulated session cost in USD (best-effort; undefined when unknown). */
  sessionCostUsd?: number;
  /** Context OS continuity/evidence health when compacted pages exist. */
  contextOS?: {
    readonly pageCount: number;
    readonly readyPageCount: number;
    readonly needsRehydrationPageCount: number;
    readonly atRiskPageCount: number;
    readonly missingEvidencePageCount: number;
    readonly evidenceIdRecallScore: number;
    readonly latestContinuityStatus: string;
  } | null;
  /** Liora Memory reflection scheduler dashboard. */
  autoDream?: {
    readonly enabled: boolean;
    readonly inFlight: boolean;
    readonly runs: number;
    readonly lastDreamAt: number | null;
    readonly lastExamined: number | null;
    readonly lastMerged: number | null;
    readonly minHours: number;
    readonly minActiveRecords: number;
  } | null;
  /** Permission interventions queued while waiting on host approval. */
  interventionCount?: number;
  /** Queue entries older than agent-core stale threshold (Ops tray stale×N). */
  staleInterventionCount?: number;
  /** Longest-waiting queued intervention age in ms (Ops/Never-Halt glance). */
  oldestInterventionAgeMs?: number;
  isCompacting: boolean;
  /**
   * Background (async) full compaction is summarizing while the turn may continue.
   * Distinct from `isCompacting`, which means the session is blocked on compaction.
   */
  isBackgroundCompacting: boolean;
  isReplaying: boolean;
  streamingPhase: 'idle' | 'waiting' | 'thinking' | 'composing' | 'shell';
  streamingStartTime: number;
  /**
   * Prompt-intelligence (LLM ghost) activity for the footer badge / spinner.
   * `idle` when nothing is in flight; `inline` / `suggest` while a request runs.
   */
  promptIntelligencePhase?: 'idle' | 'inline' | 'suggest';
  activityTip?: string | null;
  theme: ThemeName;
  /** Persisted UI language preference (`tui.toml` `locale`). */
  locale?: import('./config').LocalePreference;
  /**
   * Performance overlay mode (`tui.toml` `performance_mode`).
   * Orthogonal to stored `[appearance]` — when active, effective look is the
   * Off pack without rewriting saved prefs.
   */
  performanceMode?: import('./config').PerformanceMode;
  disablePasteBurst?: boolean;
  version: string;
  editorCommand: string | null;
  notifications: NotificationsConfig;
  upgrade: UpgradePreferences;
  appearance?: AppearancePreferences;
  /** Status-bar (footer) visibility + label style from `tui.toml` `[footer]`. */
  footer?: FooterPreferences;
  /** Persisted first-run flags from `tui.toml` `[onboarding]`. */
  onboarding?: OnboardingPreferences;
  availableModels: Record<string, ModelAlias>;
  availableProviders: Record<string, ProviderConfig>;
  /**
   * Media policy when the current chat model is text-only (config.toml
   * `[media] nonVisionFallback`). 'analyze' renders attached images/videos
   * to text with a vision-capable catalog model; 'path' leaves a pointer
   * note; 'block' refuses the send. Fail-open default: 'analyze'.
   */
  nonVisionFallbackPolicy?: 'analyze' | 'path' | 'block';
  providerRouteStatus?: ProviderRouteStatus | null;
  /**
   * Last successful step-level provider route selection (effective model +
   * credential). Updated from `turn.step.completed.providerRouteSelection`.
   */
  lastProviderRouteSelection?: ProviderRouteSelection | null;
  /**
   * One-shot route transparency: last failover / model switch the TUI surfaced
   * (footer pulse + /status). Cleared when the user switches models manually.
   */
  lastModelRouteNotice?: {
    readonly kind: 'failover' | 'switch' | 'selection';
    readonly fromAlias?: string;
    readonly toAlias: string;
    readonly providerName?: string;
    readonly credentialLabel?: string;
    readonly providerModel?: string;
    readonly reason?: string;
    readonly atMs: number;
  } | null;
  sessionTitle: string | null;
  /** Current goal snapshot for the footer badge; null/undefined when no active goal. */
  goal?: GoalSnapshot | null;
  /** Brief goal progress pulse (Dopamine Ops) — ~2s footer `xp` badge. */
  goalXpPulse?: { readonly atMs: number } | null;
  /** Goal progress/evidence ticks for Ops Goal pane when contextOS pages are absent. */
  goalEvidenceCount?: number;
  /** W6 verification sensor soft advisory for Ops Goal pane (recent test/check failures). */
  goalSoftAdvisory?: string | null;
  /** Brief worker-completion pulse (Dopamine Ops) — ~2s footer `done` badge. */
  fleetFlourish?: { readonly atMs: number } | null;
  /** Brief permission approval pulse (Dopamine Ops) — ~2s footer `perm✓` badge. */
  permissionApproveFlourish?: { readonly atMs: number } | null;
  /** Brief git file-count churn pulse (Dopamine Ops) — ~2s footer `diff↑` badge. */
  gitChurn?: { readonly atMs: number; readonly count: number } | null;
  /** Ephemeral triple-alignment combo (goal-xp + cache target + fleet); render-computed. */
  opsCombo?: { readonly atMs: number; readonly score: number } | null;
  mcpServersSummary: string | null;
  /** Short-lived footer badge after extensions hot-reload (MCP/skills/import). */
  extensionsReload?: { readonly atMs: number } | null;
  /**
   * Never-Halt degraded runtime (search/oauth/llm/…). Cleared on turn end or recovery.
   * Drives Ops footer badge without hard-stopping Goal/Mission.
   */
  runtimeDegraded?: {
    readonly scope: string;
    readonly reason: string;
    readonly hint?: string;
    readonly atMs: number;
  } | null;
  /** Brief DeepResearch / search channel cascade hint for footer + Ops (~30s). */
  searchCascade?: {
    readonly channelsTried: readonly string[];
    readonly hops?: number;
    readonly atMs: number;
  } | null;
  /** Optional banner shown below the welcome panel; null means no banner to render. */
  banner?: BannerState | null;
  /** Live provider quota / usage snapshot for the footer badge and /usage panel. */
  providerQuota?: AllProvidersUsageSnapshot | null;
  /** Prompt-cache hit meter synced from agent.status.updated / getStatus. */
  cacheMeter?: { readonly rate: number; readonly streak: number } | null;
  /** Circuit breaker registry synced from agent.status.updated / getStatus. */
  circuitBreakers?: {
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
  } | null;
  /** Update available notice from preflight; shown as a header badge. */
  updateNotice?: { readonly currentVersion: string; readonly targetVersion: string; readonly installCommand: string } | null;
  /**
   * Auto-update lifecycle for toast + header + transcript (completed / failed /
   * installing / available). Set once at startup from preflight.
   */
  updateLifecycle?: {
    readonly kind: 'completed' | 'failed' | 'installing' | 'available';
    readonly version: string;
    readonly title: string;
    readonly detail?: string;
    readonly source?: string;
    readonly currentVersion?: string;
    readonly installCommand?: string;
  } | null;
  /** Last completed step TTFT sample for Host settings (W8 latency profile). */
  lastStepTtft?: {
    readonly ms: number;
    readonly turnId?: number;
    readonly step?: number;
    readonly atMs: number;
    readonly requestBuildMs?: number;
    readonly serverFirstTokenMs?: number;
  } | null;
  /** Rolling TTFT totals (ms) for session p50 — capped at HOST_TTFT_WINDOW_MAX. */
  lastStepTtftMsWindow?: readonly number[] | null;
}

export interface ToolCallBlockData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  description?: string;
  display?: ToolInputDisplay;
  streamingArguments?: string;
  streamingStartedAtMs?: number;
  result?: ToolResultBlockData;
  subagent?: SubagentReplayBlockData;
  step?: number;
  turnId?: string;
  /** Set when the step ended (e.g. max_tokens) before the tool call's
   *  arguments finished streaming. Renderer flips the header verb to
   *  "Truncated" and stops showing the in-progress argument preview. */
  truncated?: boolean;
}

export interface ToolResultBlockData {
  tool_call_id: string;
  output: string;
  is_error?: boolean;
  synthetic?: boolean;
  /**
   * Structured projection emitted by agent-core (`tool.result` `display`).
   * Present only when the harness recognized the result shape; neat cards read
   * it instead of parsing `output`.
   */
  display?: ToolResultDisplay;
}

export interface SubagentReplayToolCallData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  description?: string;
  result?: ToolResultBlockData;
}

export interface SubagentReplayBlockData {
  id: string;
  name?: string;
  text?: string;
  toolCalls?: readonly SubagentReplayToolCallData[];
}

export interface BackgroundAgentMetadata {
  readonly agentId: string;
  readonly parentToolCallId: string;
  readonly agentName?: string;
  readonly description?: string;
  /** Effective model alias for this child when known (explore cheap route etc.). */
  readonly modelAlias?: string;
}

export type BackgroundAgentStatusPhase = 'started' | 'completed' | 'failed';

export interface BackgroundAgentStatusData {
  readonly phase: BackgroundAgentStatusPhase;
  readonly headline: string;
  readonly detail?: string;
}

export interface CompactionTranscriptData {
  readonly result?: 'cancelled';
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly instruction?: string;
}

export interface CronTranscriptData {
  readonly jobId?: string;
  readonly cron?: string;
  readonly recurring?: boolean;
  readonly coalescedCount?: number;
  readonly stale?: boolean;
  readonly missedCount?: number;
}

export type GoalTranscriptData =
  | { readonly kind: 'created' }
  | { readonly kind: 'lifecycle'; readonly change: GoalChange };

/**
 * How much detail the transcript renders for tool activity. See
 * `src/tui/config.ts` (`TranscriptDetailSchema`) for the persisted setting;
 * this type is the runtime handle used by transcript projection/rendering.
 */
export type TranscriptDetailLevel = 'minimal' | 'compact' | 'standard' | 'full';

export type TranscriptEntryKind =
  | 'welcome'
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'thinking'
  | 'status'
  | 'skill_activation'
  | 'plugin_command'
  | 'cron'
  | 'goal'
  | 'plan';

/** Full plan markdown mirrored into the main transcript for plan_review. */
export interface PlanTranscriptData {
  readonly content: string;
  readonly path?: string | undefined;
  /** Approval tool_call_id — used to dedupe mirrors for the same review. */
  readonly toolCallId?: string | undefined;
}

export type SkillActivationTrigger = 'user-slash' | 'model-tool' | 'nested-skill';
export type PluginCommandTrigger = 'user-slash';

export interface TranscriptEntry {
  id: string;
  kind: TranscriptEntryKind;
  turnId?: string;
  renderMode: 'markdown' | 'plain' | 'notice';
  content: string;
  color?: ColorToken;
  detail?: string;
  /** Optional override for the leading bullet of a 'user' message entry. An empty string suppresses the bullet entirely (used by shell-command echoes so `$` replaces the sparkles marker). */
  bullet?: string;
  /** Epoch milliseconds — wall-clock time the turn started. Only set when the real time is known (live input); replayed history without a source timestamp omits it. */
  timestamp?: number;
  toolCallData?: ToolCallBlockData;
  backgroundAgentStatus?: BackgroundAgentStatusData;
  compactionData?: CompactionTranscriptData;
  cronData?: CronTranscriptData;
  goalData?: GoalTranscriptData;
  planData?: PlanTranscriptData;
  imageAttachmentIds?: readonly number[];
  skillActivationId?: string;
  skillName?: string;
  skillArgs?: string;
  skillTrigger?: SkillActivationTrigger;
  pluginCommandActivationId?: string;
  pluginId?: string;
  pluginCommandName?: string;
  pluginCommandArgs?: string;
  pluginCommandTrigger?: PluginCommandTrigger;
}

export type LivePaneMode =
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'tool'
  | 'session';

export interface LivePaneState {
  mode: LivePaneMode;
  pendingApproval: PendingApproval | null;
  pendingQuestion: PendingQuestion | null;
}

export interface QueuedMessage {
  readonly text: string;
  readonly displayText?: string;
  readonly agentId?: string;
  readonly parts?: readonly PromptPart[];
  readonly imageAttachmentIds?: readonly number[];
  /** `bash` for a `!` shell command queued while another command is running;
   *  undefined (=`prompt`) for a normal message. */
  readonly mode?: 'prompt' | 'bash';
}

export const INITIAL_LIVE_PANE: LivePaneState = {
  mode: 'idle',
  pendingApproval: null,
  pendingQuestion: null,
};

// ---------------------------------------------------------------------------
// TUI startup / options types (extracted from kimi-tui.ts)
// ---------------------------------------------------------------------------

export interface TUIStartupOptions {
  readonly sessionFlag?: string;
  readonly continueLast: boolean;
  readonly yolo: boolean;
  readonly auto: boolean;
  readonly plan: boolean;
  readonly model?: string;
  readonly startupNotice?: string;
  readonly resumeGoal?: boolean;
}

export type TUIStartupState = 'pending' | 'ready' | 'picker';

export interface LioraTUIOptions {
  initialAppState: AppState;
  startup: TUIStartupOptions;
  renderer?: TerminalRenderer;
  /** Optional session metadata (e.g. worktree) stamped on createSession. */
  readonly sessionMetadata?: import('@superliora/sdk').JsonObject;
}

export interface PendingExit {
  readonly kind: 'ctrl-c' | 'ctrl-d';
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface LoginProgressSpinnerHandle {
  stop(opts: { ok: boolean; label: string }): void;
  setLabel(label: string): void;
}

export interface LioraTUIStartupInput {
  readonly cliOptions: import('#/cli/options').CLIOptions;
  readonly additionalDirs?: readonly string[];
  readonly tuiConfig: import('./config').TuiConfig;
  readonly version: string;
  readonly workDir: string;
  readonly startupNotice?: string;
  readonly updateNotice?: {
    readonly currentVersion: string;
    readonly targetVersion: string;
    readonly installCommand: string;
  };
  readonly updateLifecycle?: AppState['updateLifecycle'];
  /** Optional session metadata (e.g. worktree) stamped on createSession. */
  readonly sessionMetadata?: import('@superliora/sdk').JsonObject;
}

export type ProgressSpinnerHandle = LoginProgressSpinnerHandle;
