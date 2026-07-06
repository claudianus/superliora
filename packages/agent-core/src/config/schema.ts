import { HOOK_EVENT_TYPES } from '../session/hooks/types';
import { parsePattern } from '#/agent/permission/matches-rule';
import { ErrorCodes, LioraError } from '#/errors';
import { z } from 'zod';

export const ProviderTypeSchema = z.enum([
  'anthropic',
  'openai',
  'kimi',
  'google-genai',
  'openai_responses',
  'vertexai',
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const OAuthRefSchema = z.object({
  storage: z.enum(['file', 'keyring']),
  key: z.string().min(1),
  oauthHost: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
});

export type OAuthRef = z.infer<typeof OAuthRefSchema>;

const StringRecordSchema = z.record(z.string(), z.string());

export const ProviderCredentialConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  rpm: z.number().int().min(1).optional(),
  tpm: z.number().int().min(1).optional(),
});

export type ProviderCredentialConfig = z.infer<typeof ProviderCredentialConfigSchema>;

export const ProviderConfigSchema = z.object({
  type: ProviderTypeSchema,
  apiKey: z.string().optional(),
  apiKeys: z.array(z.string().min(1)).optional(),
  credentials: z.array(ProviderCredentialConfigSchema).optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  oauth: OAuthRefSchema.optional(),
  oauths: z.array(OAuthRefSchema).optional(),
  env: StringRecordSchema.optional(),
  customHeaders: StringRecordSchema.optional(),
  source: z.record(z.string(), z.unknown()).optional(),
});

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
});

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
  protocol: z.literal('anthropic').optional(),
  adaptiveThinking: z.boolean().optional(),
  betaApi: z.boolean().optional(),
  fallbackModels: z.array(z.string().min(1)).optional(),
  routing: ModelRoutingConfigSchema.optional(),
});

export const ModelAliasOverrideSchema = ModelAliasBaseSchema.omit({
  provider: true,
  model: true,
  protocol: true,
  betaApi: true,
}).partial();

export type ModelAliasOverrides = z.infer<typeof ModelAliasOverrideSchema>;

export const ModelAliasSchema = ModelAliasBaseSchema.extend({
  overrides: ModelAliasOverrideSchema.optional(),
});

export type ModelAlias = z.infer<typeof ModelAliasSchema>;

export const ThinkingConfigSchema = z.object({
  mode: z.enum(['auto', 'on', 'off']).optional(),
  effort: z.string().optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

export const PermissionModeSchema = z.enum(['yolo', 'manual', 'auto']);

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
});

export const PermissionConfigSchema = z.object({
  rules: z.array(PermissionRuleSchema).optional(),
});

export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;

export const LoopControlSchema = z.object({
  maxStepsPerTurn: z.number().int().min(0).optional(),
  maxRetriesPerStep: z.number().int().min(0).optional(),
  maxRalphIterations: z.number().int().min(-1).optional(),
  reservedContextSize: z.number().int().min(0).optional(),
  compactionTriggerRatio: z.number().min(0.5).max(0.99).optional(),
  compactionBlockRatio: z.number().min(0.5).max(0.99).optional(),
  compactionTriggerTokens: z.number().int().min(1000).optional(),
  compactionMaxRecentMessages: z.number().int().min(1).optional(),
});

export type LoopControl = z.infer<typeof LoopControlSchema>;

export const BackgroundConfigSchema = z.object({
  maxRunningTasks: z.number().int().min(1).optional(),
  keepAliveOnExit: z.boolean().optional(),
  killGracePeriodMs: z.number().int().min(0).optional(),
  printWaitCeilingS: z.number().int().min(1).optional(),
});

export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>;

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  storePath: z.string().min(1).optional(),
  maxRetrieved: z.number().int().min(0).max(20).optional(),
  autoCapture: z.boolean().optional(),
  captureEpisodic: z.boolean().optional(),
  autoConsolidate: z.boolean().optional(),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const ResearchIntensitySchema = z.enum(['balanced', 'premium', 'max']);
export type ResearchIntensity = z.infer<typeof ResearchIntensitySchema>;

export const ResearchLocalDirectSourcesSchema = z.object({
  github: z.boolean().optional(),
  arxiv: z.boolean().optional(),
  npm: z.boolean().optional(),
  pypi: z.boolean().optional(),
  crates: z.boolean().optional(),
});

export type ResearchLocalDirectSources = z.infer<typeof ResearchLocalDirectSourcesSchema>;

export const ResearchLocalSearchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  searxngUrl: z.string().url().optional(),
  yacyUrl: z.string().url().optional(),
  directSources: ResearchLocalDirectSourcesSchema.optional(),
  renderedFetch: z.boolean().optional(),
  offlineMode: z.enum(['auto', 'always', 'never']).optional(),
});

export type ResearchLocalSearchConfig = z.infer<typeof ResearchLocalSearchConfigSchema>;

export const ResearchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intensity: ResearchIntensitySchema.optional(),
  localSearch: ResearchLocalSearchConfigSchema.optional(),
  persistVerifiedFindings: z.boolean().optional(),
});

export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;

export const ModelCatalogConfigSchema = z.object({
  refreshIntervalMs: z.number().int().min(0).optional(),
  refreshOnStart: z.boolean().optional(),
});

export type ModelCatalogConfig = z.infer<typeof ModelCatalogConfigSchema>;

export const ExperimentalConfigSchema = z.record(z.string(), z.boolean());

export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;

export const HookDefSchema = z
  .object({
    event: z.enum(HOOK_EVENT_TYPES),
    matcher: z.string().optional(),
    command: z.string().min(1),
    timeout: z.number().int().min(1).max(600).optional(),
  })
  .strict();

export type HookDefConfig = z.infer<typeof HookDefSchema>;

export const MoonshotServiceConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  oauth: OAuthRefSchema.optional(),
  customHeaders: StringRecordSchema.optional(),
});

export type MoonshotServiceConfig = z.infer<typeof MoonshotServiceConfigSchema>;

export const ServicesConfigSchema = z.object({
  moonshotSearch: MoonshotServiceConfigSchema.optional(),
  moonshotFetch: MoonshotServiceConfigSchema.optional(),
});

export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;

export const BrowserUseConfigSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['cloakbrowser']).optional(),
  autoInstall: z.boolean().optional(),
  autoUpdate: z.boolean().optional(),
  cacheDir: z.string().min(1).optional(),
  binaryPath: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  licenseKeyEnv: z.string().min(1).optional(),
});

export type BrowserUseConfig = z.infer<typeof BrowserUseConfigSchema>;

export const ComputerUseConfigSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['cua-driver']).optional(),
  autoInstall: z.boolean().optional(),
  driverCmd: z.string().min(1).optional(),
  requireApproval: z.boolean().optional(),
});

export type ComputerUseConfig = z.infer<typeof ComputerUseConfigSchema>;

const McpServerCommonFields = {
  enabled: z.boolean().optional(),
  startupTimeoutMs: z.number().int().min(1).optional(),
  toolTimeoutMs: z.number().int().min(1).optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
} as const;

export const McpServerStdioConfigSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: StringRecordSchema.optional(),
  cwd: z.string().optional(),
  // Reserved for future kaos-backed stdio launchers. `undefined` and `'local'`
  // both mean direct child_process spawn for now.
  executor: z.enum(['local', 'kaos']).optional(),
  ...McpServerCommonFields,
});

export type McpServerStdioConfig = z.infer<typeof McpServerStdioConfigSchema>;

export const McpServerHttpConfigSchema = z.object({
  transport: z.literal('http'),
  url: z.string().url(),
  headers: StringRecordSchema.optional(),
  // Indirect secret reference: the bearer token is looked up from
  // `process.env[bearerTokenEnvVar]` at connection time, never committed.
  bearerTokenEnvVar: z.string().min(1).optional(),
  ...McpServerCommonFields,
});

export type McpServerHttpConfig = z.infer<typeof McpServerHttpConfigSchema>;

export const McpServerSseConfigSchema = z.object({
  transport: z.literal('sse'),
  url: z.string().url(),
  headers: StringRecordSchema.optional(),
  // Indirect secret reference: the bearer token is looked up from
  // `process.env[bearerTokenEnvVar]` at connection time, never committed.
  bearerTokenEnvVar: z.string().min(1).optional(),
  ...McpServerCommonFields,
});

export type McpServerSseConfig = z.infer<typeof McpServerSseConfigSchema>;

export type McpRemoteServerConfig = McpServerHttpConfig | McpServerSseConfig;

const McpServerConfigDiscriminatedSchema = z.discriminatedUnion('transport', [
  McpServerStdioConfigSchema,
  McpServerHttpConfigSchema,
  McpServerSseConfigSchema,
]);

export const McpServerConfigSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if ('transport' in obj) return obj;
  if (typeof obj['command'] === 'string') return { ...obj, transport: 'stdio' };
  if (typeof obj['url'] === 'string') return { ...obj, transport: 'http' };
  return obj;
}, McpServerConfigDiscriminatedSchema);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const LioraConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  models: z.record(z.string(), ModelAliasSchema).optional(),
  thinking: ThinkingConfigSchema.optional(),
  planMode: z.boolean().optional(),
  yolo: z.boolean().optional(),
  defaultThinking: z.boolean().optional(),
  defaultPermissionMode: PermissionModeSchema.optional(),
  defaultPlanMode: z.boolean().optional(),
  permission: PermissionConfigSchema.optional(),
  hooks: z.array(HookDefSchema).optional(),
  services: ServicesConfigSchema.optional(),
  mergeAllAvailableSkills: z.boolean().optional(),
  extraSkillDirs: z.array(z.string()).optional(),
  skillSearchLimit: z.number().int().min(1).max(20).optional(),
  skillSearchMaxLimit: z.number().int().min(1).max(20).optional(),
  skillPromptMode: z.enum(['search', 'legacy-list']).optional(),
  loopControl: LoopControlSchema.optional(),
  background: BackgroundConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  research: ResearchConfigSchema.optional(),
  modelCatalog: ModelCatalogConfigSchema.optional(),
  browserUse: BrowserUseConfigSchema.optional(),
  computerUse: ComputerUseConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  telemetry: z.boolean().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export type LioraConfig = z.infer<typeof LioraConfigSchema>;

const ProviderConfigPatchSchema = ProviderConfigSchema.partial();
const ModelAliasPatchSchema = ModelAliasSchema.partial();
const ThinkingConfigPatchSchema = ThinkingConfigSchema.partial();
const PermissionConfigPatchSchema = PermissionConfigSchema.partial();
const LoopControlPatchSchema = LoopControlSchema.partial();
const BackgroundConfigPatchSchema = BackgroundConfigSchema.partial();
const MemoryConfigPatchSchema = MemoryConfigSchema.partial();
const ResearchLocalDirectSourcesPatchSchema = ResearchLocalDirectSourcesSchema.partial();
const ResearchLocalSearchConfigPatchSchema = ResearchLocalSearchConfigSchema.extend({
  directSources: ResearchLocalDirectSourcesPatchSchema.optional(),
}).partial();
const ResearchConfigPatchSchema = ResearchConfigSchema.extend({
  localSearch: ResearchLocalSearchConfigPatchSchema.optional(),
}).partial();
const ModelCatalogConfigPatchSchema = ModelCatalogConfigSchema.partial();
const BrowserUseConfigPatchSchema = BrowserUseConfigSchema.partial();
const ComputerUseConfigPatchSchema = ComputerUseConfigSchema.partial();
const ExperimentalConfigPatchSchema = ExperimentalConfigSchema;
const MoonshotServiceConfigPatchSchema = MoonshotServiceConfigSchema.partial();
const ServicesConfigPatchSchema = z.object({
  moonshotSearch: MoonshotServiceConfigPatchSchema.optional(),
  moonshotFetch: MoonshotServiceConfigPatchSchema.optional(),
});

export const LioraConfigPatchSchema = z
  .object({
    providers: z.record(z.string(), ProviderConfigPatchSchema).optional(),
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    models: z.record(z.string(), ModelAliasPatchSchema).optional(),
    thinking: ThinkingConfigPatchSchema.optional(),
    planMode: z.boolean().optional(),
    yolo: z.boolean().optional(),
    defaultThinking: z.boolean().optional(),
    defaultPermissionMode: PermissionModeSchema.optional(),
    defaultPlanMode: z.boolean().optional(),
    permission: PermissionConfigPatchSchema.optional(),
    hooks: z.array(HookDefSchema).optional(),
    services: ServicesConfigPatchSchema.optional(),
    mergeAllAvailableSkills: z.boolean().optional(),
    extraSkillDirs: z.array(z.string()).optional(),
    skillSearchLimit: z.number().int().min(1).max(20).optional(),
    skillSearchMaxLimit: z.number().int().min(1).max(20).optional(),
    skillPromptMode: z.enum(['search', 'legacy-list']).optional(),
    loopControl: LoopControlPatchSchema.optional(),
    background: BackgroundConfigPatchSchema.optional(),
    memory: MemoryConfigPatchSchema.optional(),
    research: ResearchConfigPatchSchema.optional(),
    modelCatalog: ModelCatalogConfigPatchSchema.optional(),
    browserUse: BrowserUseConfigPatchSchema.optional(),
    computerUse: ComputerUseConfigPatchSchema.optional(),
    experimental: ExperimentalConfigPatchSchema.optional(),
    telemetry: z.boolean().optional(),
  })
  .strict();

export type LioraConfigPatch = z.infer<typeof LioraConfigPatchSchema>;

export function getDefaultConfig(): LioraConfig {
  return {
    providers: {},
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
