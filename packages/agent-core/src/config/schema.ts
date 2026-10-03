import { parsePattern } from '#/agent/permission/matches-rule';
import { ErrorCodes, LioraError } from '#/errors/index';
import { z } from 'zod';

export const ProviderTypeSchema = z.enum([
  'anthropic',
  'openai',
  'kimi',
  'google-genai',
  'code-assist',
  'codewhisperer',
  'openai_responses',
  'vertexai',
  'bedrock',
  'vertex_claude',
  'cursor',
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const OAuthRefSchema = z.object({
  storage: z.enum(['file', 'keyring']),
  key: z.string().min(1),
  oauthHost: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
}).strict();

export type OAuthRef = z.infer<typeof OAuthRefSchema>;

const StringRecordSchema = z.record(z.string(), z.string());

export const ProviderCredentialConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  rpm: z.number().int().min(1).optional(),
  tpm: z.number().int().min(1).optional(),
}).strict();

export type ProviderCredentialConfig = z.infer<typeof ProviderCredentialConfigSchema>;

export const ProviderConfigSchema = z.object({
  type: ProviderTypeSchema,
  apiKey: z.string().optional(),
  apiKeys: z.array(z.string().min(1)).optional(),
  credentials: z.array(ProviderCredentialConfigSchema).optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  /** Cloud Code Assist project id (Google Code Assist OAuth logins). */
  project: z.string().optional(),
  oauth: OAuthRefSchema.optional(),
  oauths: z.array(OAuthRefSchema).optional(),
  env: StringRecordSchema.optional(),
  customHeaders: StringRecordSchema.optional(),
  source: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ModelRoutingStrategySchema = z.enum([
  'auto',
  'fallback',
  'fill_first',
  'round_robin',
  'weighted_round_robin',
  'least_used',
  'lowest_latency',
  'rate_limit_aware',
  'random',
]);

export type ModelRoutingStrategy = z.infer<typeof ModelRoutingStrategySchema>;

export const ModelRoutingConfigSchema = z.object({
  strategy: ModelRoutingStrategySchema.optional(),
  cooldownMs: z.number().int().min(0).optional(),
  weights: z.record(z.string().min(1), z.number().int().min(1)).optional(),
  sessionAffinity: z.boolean().optional(),
  preferredCredential: z.string().min(1).optional(),
  /**
   * Opt in to appending every same-capability model from other credentialed
   * providers as route candidates. Off by default: without an explicit
   * `fallback_models` list the route never silently falls back to models the
   * user did not choose (unexpected cost/quality changes).
   */
  autoFallback: z.boolean().optional(),
}).strict();

export type ModelRoutingConfig = z.infer<typeof ModelRoutingConfigSchema>;

const ModelAliasBaseSchema = z.object({
  provider: z.string(),
  model: z.string(),
  maxContextSize: z.number().int().min(1),
  maxOutputSize: z.number().int().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  supportEfforts: z.array(z.string().min(1)).optional(),
  defaultEffort: z.string().min(1).optional(),
  displayName: z.string().optional(),
  reasoningKey: z.string().optional(),
  protocol: z.enum(['anthropic', 'openai', 'openai_responses']).optional(),
  adaptiveThinking: z.boolean().optional(),
  betaApi: z.boolean().optional(),
  fallbackModels: z.array(z.string().min(1)).optional(),
  routing: ModelRoutingConfigSchema.optional(),
  /** Marks a user-added custom model that should survive provider refreshes. */
  userManaged: z.boolean().optional(),
  /** Per-million-token pricing in USD (from models.dev catalog). */
  cost: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const ModelAliasOverrideSchema = ModelAliasBaseSchema.omit({
  provider: true,
  model: true,
  protocol: true,
  betaApi: true,
}).partial();

export type ModelAliasOverrides = z.infer<typeof ModelAliasOverrideSchema>;

export const ModelAliasSchema = ModelAliasBaseSchema.extend({
  overrides: ModelAliasOverrideSchema.optional(),
}).strict();

export type ModelAlias = z.infer<typeof ModelAliasSchema>;

export const ThinkingConfigSchema = z.object({
  mode: z.enum(['auto', 'on', 'off']).optional(),
  effort: z.string().optional(),
}).strict();

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

export const PermissionModeSchema = z.enum(['yolo', 'manual', 'auto']);

/**
 * Path-sandbox profile for file tools (Read/Write/Edit/Grep/Glob/RepoQuery).
 * Lexical workspace guard only — not OS isolation.
 */
export const SandboxProfileSchema = z.enum(['off', 'workspace', 'read-only']);

export type SandboxProfileConfig = z.infer<typeof SandboxProfileSchema>;

export const SandboxEnforcementSchema = z.enum(['lexical', 'process']);

export type SandboxEnforcementConfig = z.infer<typeof SandboxEnforcementSchema>;

export const PermissionRuleDecisionSchema = z.enum(['allow', 'deny', 'ask']);
export const PermissionRuleScopeSchema = z.enum([
  'turn-override',
  'session-runtime',
  'project',
  'user',
]);

export const PermissionRuleSchema = z.object({
  decision: PermissionRuleDecisionSchema,
  scope: PermissionRuleScopeSchema.default('user'),
  pattern: z.string().min(1).refine(isValidPermissionPattern, {
    message: 'Invalid permission rule pattern',
  }),
  reason: z.string().optional(),
}).strict();

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionConfigSchema = z.object({
  rules: z.array(PermissionRuleSchema).optional(),
}).strict();

export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;

export const LoopControlSchema = z.object({
  maxStepsPerTurn: z.number().int().min(0).optional(),
}).strict();

export type LoopControl = z.infer<typeof LoopControlSchema>;

export const BackgroundConfigSchema = z.object({
  maxRunningTasks: z.number().int().min(1).optional(),
  killGracePeriodMs: z.number().int().min(0).optional(),
  printWaitCeilingS: z.number().int().min(1).optional(),
}).strict();

export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>;


export const CacheConfigSchema = z.object({
  /** Bumped by Settings → Cache invalidate; folded into prompt_cache_key as sessionId:vN. */
  invalidateEpoch: z.number().int().min(0).optional(),
}).strict();

export type CacheConfig = z.infer<typeof CacheConfigSchema>;


export const ModelCatalogConfigSchema = z.object({
  refreshIntervalMs: z.number().int().min(0).optional(),
  refreshOnStart: z.boolean().optional(),
}).strict();

export type ModelCatalogConfig = z.infer<typeof ModelCatalogConfigSchema>;


export const LioraConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  models: z.record(z.string(), ModelAliasSchema).optional(),
  thinking: ThinkingConfigSchema.optional(),
  yolo: z.boolean().optional(),
  defaultThinking: z.boolean().optional(),
  defaultPermissionMode: PermissionModeSchema.optional(),
  /**
   * Path sandbox for file tools: off | workspace | read-only.
   * Default when omitted is off (see resolveSandboxProfileFromSources).
   * Not an OS sandbox — Bash/network/computer-use are out of scope.
   */
  sandboxProfile: SandboxProfileSchema.optional(),
  /**
   * How hard to enforce the path sandbox: lexical (default) or process
   * (Docker when present; otherwise Windows Job Object tree — not an FS jail).
   */
  sandboxEnforcement: SandboxEnforcementSchema.optional(),
  permission: PermissionConfigSchema.optional(),
  loopControl: LoopControlSchema.optional(),
  background: BackgroundConfigSchema.optional(),
  cache: CacheConfigSchema.optional(),
  modelCatalog: ModelCatalogConfigSchema.optional(),
  telemetry: z.boolean().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type LioraConfig = z.infer<typeof LioraConfigSchema>;

const ProviderConfigPatchSchema = ProviderConfigSchema.partial();
const ModelAliasPatchSchema = ModelAliasSchema.partial();
const ThinkingConfigPatchSchema = ThinkingConfigSchema.partial();
const PermissionConfigPatchSchema = PermissionConfigSchema.partial();
const LoopControlPatchSchema = LoopControlSchema.partial();
const BackgroundConfigPatchSchema = BackgroundConfigSchema.partial();
const CacheConfigPatchSchema = CacheConfigSchema.partial();
const ModelCatalogConfigPatchSchema = ModelCatalogConfigSchema.partial();

export const LioraConfigPatchSchema = z
  .object({
    providers: z.record(z.string(), ProviderConfigPatchSchema).optional(),
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    models: z.record(z.string(), ModelAliasPatchSchema).optional(),
    thinking: ThinkingConfigPatchSchema.optional(),
    yolo: z.boolean().optional(),
    defaultThinking: z.boolean().optional(),
    defaultPermissionMode: PermissionModeSchema.optional(),
    sandboxProfile: SandboxProfileSchema.optional(),
    sandboxEnforcement: SandboxEnforcementSchema.optional(),
    permission: PermissionConfigPatchSchema.optional(),
    loopControl: LoopControlPatchSchema.optional(),
    background: BackgroundConfigPatchSchema.optional(),
    cache: CacheConfigPatchSchema.optional(),
    modelCatalog: ModelCatalogConfigPatchSchema.optional(),
    telemetry: z.boolean().optional(),
  })
  .strict();

export type LioraConfigPatch = z.infer<typeof LioraConfigPatchSchema>;

export function getDefaultConfig(): LioraConfig {
  return {
    providers: {},
    // Product default: YOLO — tools auto-approved, still asks for high-risk deletes/secrets.
    defaultPermissionMode: 'yolo',
  };
}

export function validateConfig(config: unknown): LioraConfig {
  try {
    return LioraConfigSchema.parse(config);
  } catch (error) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid configuration: ${formatConfigValidationError(error)}`, {
      cause: error,
    });
  }
}

export function formatConfigValidationError(error: unknown): string {
  const missingModelContextSize = missingModelContextSizeMessage(error);
  if (missingModelContextSize !== undefined) return missingModelContextSize;
  return error instanceof Error ? error.message : String(error);
}

function missingModelContextSizeMessage(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  for (const issue of error.issues) {
    const [section, modelName, field] = issue.path;
    if (section === 'models' && typeof modelName === 'string' && field === 'maxContextSize') {
      return `Model "${modelName}" must define a positive max_context_size in config.toml.`;
    }
  }
  return undefined;
}

function isValidPermissionPattern(pattern: string): boolean {
  try {
    parsePattern(pattern);
    return true;
  } catch {
    return false;
  }
}
