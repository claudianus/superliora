import { z } from 'zod';

export interface TokenUsage {
  readonly inputOther: number;
  readonly output: number;
  readonly inputCacheRead: number;
  readonly inputCacheCreation: number;
}

export type FinishReason =
  | 'completed'
  | 'tool_calls'
  | 'truncated'
  | 'filtered'
  | 'paused'
  | 'other';

export type CacheMissReason = 'schema_change' | 'prefix_drift' | 'model_switch';

export type CacheMissReasonHistogram = Partial<Record<CacheMissReason, number>>;

export interface CacheDiagnostics {
  /** Deterministic hash of the serialized tool block (name+description+schema). */
  readonly toolBlockHash: string;
  /** True when the tool block changed since the previous step. */
  readonly toolBlockChanged: boolean;
  /** Number of injection messages appended in the last step. */
  readonly injectionCount: number;
  /** Total conversation message count at the last step. */
  readonly messageCount: number;
  /** Session step-level prompt-cache miss buckets (harness stub until provider reports). */
  readonly missReasons?: CacheMissReasonHistogram;
}

/** W13 never-empty search counters (WebSearch / DeepResearch degrade paths). */
export interface SearchNeverEmptyTelemetry {
  readonly hardFailCount: number;
  readonly softDegradeCount: number;
}

/** W13 LocalResearchCache session lookup counters (WebSearch / DeepResearch). */
export interface LocalResearchCacheTelemetry {
  readonly hits: number;
  readonly misses: number;
  readonly hitRate?: number;
}

export interface UsageStatus {
  readonly byModel?: Record<string, TokenUsage>;
  readonly currentTurn?: TokenUsage;
  readonly total?: TokenUsage;
  /**
   * Session prompt-cache hit rate in 0..1: cache-read input tokens over total
   * input tokens across the session. Undefined before any usage is recorded.
   * A byte-stable cached prefix approaches 1 at steady state; a volatile
   * segment inside the prefix keeps this near 0.
   */
  readonly cacheHitRate?: number;
  /**
   * Consecutive completed turns whose turn-level prompt-cache hit rate was
   * ≥0.99 with enough input tokens (≥100). Resets when a qualifying turn
   * misses the target.
   */
  readonly cacheWarmStreak?: number;
  /**
   * Cache-prefix stability diagnostics. Present once the agent has recorded
   * at least one step; used by TUI/status to surface cache-busting events.
   */
  readonly cacheDiagnostics?: CacheDiagnostics;
  /** W13 never-empty counters when search tools record degrade paths. */
  readonly searchNeverEmpty?: SearchNeverEmptyTelemetry;
  /** W13 LocalResearchCache hit/miss when disk cache lookups occur in session. */
  readonly localResearchCache?: LocalResearchCacheTelemetry;
}

export type PermissionMode = 'manual' | 'yolo' | 'auto';

export type SkillSource = 'project' | 'user' | 'extra' | 'builtin';

export type LioraErrorCode =
  | 'config.invalid'
  | 'session.not_found'
  | 'session.already_exists'
  | 'session.id_invalid'
  | 'session.id_required'
  | 'session.id_empty'
  | 'session.title_empty'
  | 'session.state_not_found'
  | 'session.state_invalid'
  | 'session.fork_active_turn'
  | 'session.export_not_found'
  | 'session.export_missing_version'
  | 'session.closed'
  | 'session.permission_mode_invalid'
  | 'session.thinking_empty'
  | 'session.model_empty'
  | 'session.plan_mode_invalid'
  | 'session.approval_handler_error'
  | 'session.question_handler_error'
  | 'session.credential_handler_error'
  | 'session.init_failed'
  | 'worktree.not_a_git_repo'
  | 'worktree.name_invalid'
  | 'worktree.name_ambiguous'
  | 'worktree.already_exists'
  | 'worktree.create_failed'
  | 'worktree.not_found'
  | 'agent.not_found'
  | 'turn.agent_busy'
  | 'goal.already_exists'
  | 'goal.not_found'
  | 'goal.objective_empty'
  | 'goal.objective_too_long'
  | 'goal.status_invalid'
  | 'goal.metadata_reserved'
  | 'goal.not_resumable'
  | 'model.not_configured'
  | 'model.config_invalid'
  | 'auth.login_required'
  | 'context.overflow'
  | 'loop.max_steps_exceeded'
  | 'provider.api_error'
  | 'provider.rate_limit'
  | 'provider.auth_error'
  | 'provider.connection_error'
  | 'skill.not_found'
  | 'skill.type_unsupported'
  | 'skill.name_empty'
  | 'records.write_failed'
  | 'compaction.failed'
  | 'compaction.unable'
  | 'background.task_id_empty'
  | 'mcp.server_not_found'
  | 'mcp.server_disabled'
  | 'mcp.startup_failed'
  | 'mcp.tool_name_collision'
  | 'plugin.not_found'
  | 'plugin.load_failed'
  | 'request.invalid'
  | 'request.work_dir_required'
  | 'request.prompt_input_empty'
  | 'shell.git_bash_not_found'
  | 'not_implemented'
  | 'internal';

export interface LioraErrorPayload {
  readonly code: LioraErrorCode;
  readonly message: string;
  readonly name?: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
}

export interface ErrorEvent extends LioraErrorPayload {
  readonly type: 'error';
}

export interface WarningEvent {
  readonly type: 'warning';
  readonly message: string;
  readonly code?: string;
  /**
   * Machine-readable supplement for code-specific handling (for example
   * `vision_analyzer.analyzed` toasts that render model/count details).
   */
  readonly details?: Record<string, unknown>;
}

export type TurnEndReason = 'completed' | 'cancelled' | 'failed' | 'filtered';

export interface ToolUpdate {
  readonly kind: 'stdout' | 'stderr' | 'progress' | 'status' | 'custom';
  readonly text?: string;
  readonly percent?: number;
  readonly customKind?: string;
  readonly customData?: unknown;
}

export const MCP_OAUTH_AUTHORIZATION_URL_TOOL_UPDATE = 'mcp.oauth.authorization_url';

export interface McpOAuthAuthorizationUrlUpdateData {
  readonly serverName: string;
  readonly authorizationUrl: string;
}

export const tokenUsageSchema = z.object({
  inputOther: z.number(),
  output: z.number(),
  inputCacheRead: z.number(),
  inputCacheCreation: z.number(),
}) satisfies z.ZodType<TokenUsage>;

export const finishReasonSchema = z.enum([
  'completed',
  'tool_calls',
  'truncated',
  'filtered',
  'paused',
  'other',
]) satisfies z.ZodType<FinishReason>;

const cacheMissReasonHistogramSchema = z
  .object({
    schema_change: z.number().int().nonnegative().optional(),
    prefix_drift: z.number().int().nonnegative().optional(),
    model_switch: z.number().int().nonnegative().optional(),
  })
  .partial() satisfies z.ZodType<CacheMissReasonHistogram>;

export const cacheDiagnosticsSchema = z.object({
  toolBlockHash: z.string(),
  toolBlockChanged: z.boolean(),
  injectionCount: z.number(),
  messageCount: z.number(),
  missReasons: cacheMissReasonHistogramSchema.optional(),
}) satisfies z.ZodType<CacheDiagnostics>;

export const searchNeverEmptyTelemetrySchema = z.object({
  hardFailCount: z.number().int().nonnegative(),
  softDegradeCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<SearchNeverEmptyTelemetry>;

export const localResearchCacheTelemetrySchema = z.object({
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<LocalResearchCacheTelemetry>;

export const usageStatusSchema = z.object({
  byModel: z.record(z.string(), tokenUsageSchema).optional(),
  currentTurn: tokenUsageSchema.optional(),
  total: tokenUsageSchema.optional(),
  cacheHitRate: z.number().optional(),
  cacheWarmStreak: z.number().int().nonnegative().optional(),
  cacheDiagnostics: cacheDiagnosticsSchema.optional(),
  searchNeverEmpty: searchNeverEmptyTelemetrySchema.optional(),
  localResearchCache: localResearchCacheTelemetrySchema.optional(),
}) satisfies z.ZodType<UsageStatus>;

export const permissionModeSchema = z.enum(['manual', 'yolo', 'auto']) satisfies z.ZodType<PermissionMode>;

export const skillSourceSchema = z.enum(['project', 'user', 'extra', 'builtin']) satisfies z.ZodType<SkillSource>;

export const kimiErrorCodeSchema = z.enum([
  'config.invalid',
  'session.not_found',
  'session.already_exists',
  'session.id_invalid',
  'session.id_required',
  'session.id_empty',
  'session.title_empty',
  'session.state_not_found',
  'session.state_invalid',
  'session.fork_active_turn',
  'session.export_not_found',
  'session.export_missing_version',
  'session.closed',
  'session.permission_mode_invalid',
  'session.thinking_empty',
  'session.model_empty',
  'session.plan_mode_invalid',
  'session.approval_handler_error',
  'session.question_handler_error',
  'session.credential_handler_error',
  'session.init_failed',
  'worktree.not_a_git_repo',
  'worktree.name_invalid',
  'worktree.name_ambiguous',
  'worktree.already_exists',
  'worktree.create_failed',
  'worktree.not_found',
  'agent.not_found',
  'turn.agent_busy',
  'goal.already_exists',
  'goal.not_found',
  'goal.objective_empty',
  'goal.objective_too_long',
  'goal.status_invalid',
  'goal.metadata_reserved',
  'goal.not_resumable',
  'model.not_configured',
  'model.config_invalid',
  'auth.login_required',
  'context.overflow',
  'loop.max_steps_exceeded',
  'provider.api_error',
  'provider.rate_limit',
  'provider.auth_error',
  'provider.connection_error',
  'skill.not_found',
  'skill.type_unsupported',
  'skill.name_empty',
  'records.write_failed',
  'compaction.failed',
  'compaction.unable',
  'background.task_id_empty',
  'mcp.server_not_found',
  'mcp.server_disabled',
  'mcp.startup_failed',
  'mcp.tool_name_collision',
  'plugin.not_found',
  'plugin.load_failed',
  'request.invalid',
  'request.work_dir_required',
  'request.prompt_input_empty',
  'shell.git_bash_not_found',
  'not_implemented',
  'internal',
]) satisfies z.ZodType<LioraErrorCode>;

export const kimiErrorPayloadSchema = z.object({
  code: kimiErrorCodeSchema,
  message: z.string(),
  name: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
}) satisfies z.ZodType<LioraErrorPayload>;

export const errorEventSchema = kimiErrorPayloadSchema.extend({
  type: z.literal('error'),
}) satisfies z.ZodType<ErrorEvent>;

export const warningEventSchema = z.object({
  type: z.literal('warning'),
  message: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<WarningEvent>;

export const turnEndReasonSchema = z.enum(['completed', 'cancelled', 'failed', 'filtered']) satisfies z.ZodType<TurnEndReason>;

export const toolUpdateSchema = z.object({
  kind: z.enum(['stdout', 'stderr', 'progress', 'status', 'custom']),
  text: z.string().optional(),
  percent: z.number().optional(),
  customKind: z.string().optional(),
  customData: z.unknown().optional(),
}) satisfies z.ZodType<ToolUpdate>;

export const mcpOAuthAuthorizationUrlUpdateDataSchema = z.object({
  serverName: z.string(),
  authorizationUrl: z.string(),
}) satisfies z.ZodType<McpOAuthAuthorizationUrlUpdateData>;
