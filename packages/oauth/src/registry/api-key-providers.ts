/**
 * API-key provider registry — the API-key counterpart to the OAuth
 * {@link ProviderProfile} registry.
 *
 * models.dev catalogs API-key auth only as `env` hints on each provider row;
 * Cline keeps a curated per-provider table (env var, doc URL, default endpoint)
 * and Hermes centralizes the same in `.env.example` + `cli-config.yaml`. This
 * module is SuperLiora's version of that table: one place that maps a provider
 * id to the credential env vars, the console/docs URL shown on missing-key
 * errors, and the default base URL used when the catalog omits `api`.
 *
 * The `wire` union mirrors `ProviderType` in `@superliora/kosong` without
 * taking a dependency on it. Bedrock / Vertex / Azure keep their own credential
 * chains (AWS SDK / GCP ADC / Entra) and are intentionally absent here.
 */

export type ApiKeyProviderWire =
  | 'anthropic'
  | 'openai'
  | 'openai_responses'
  | 'kimi'
  | 'google-genai';

export interface ApiKeyProviderDefinition {
  /** Provider id as used in config + models.dev (lowercase, e.g. `openrouter`). */
  readonly id: string;
  readonly displayName: string;
  readonly wire: ApiKeyProviderWire;
  /** Env vars carrying the API key, in lookup order. */
  readonly envVars: readonly string[];
  /** Where an API key can be obtained (shown on missing-key errors). */
  readonly docUrl: string;
  /** Default base URL when the catalog entry omits `api`. */
  readonly defaultBaseUrl?: string;
  /** Local providers (Ollama / LM Studio) need no key. */
  readonly local?: boolean;
}

export const API_KEY_PROVIDERS: readonly ApiKeyProviderDefinition[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    wire: 'openai',
    envVars: ['OPENAI_API_KEY'],
    docUrl: 'https://platform.openai.com/api-keys',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    wire: 'anthropic',
    envVars: ['ANTHROPIC_API_KEY'],
    docUrl: 'https://console.anthropic.com',
    defaultBaseUrl: 'https://api.anthropic.com',
  },
  {
    id: 'google',
    displayName: 'Google Gemini',
    wire: 'google-genai',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    docUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    wire: 'openai',
    envVars: ['OPENROUTER_API_KEY'],
    docUrl: 'https://openrouter.ai/keys',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    wire: 'openai',
    envVars: ['DEEPSEEK_API_KEY'],
    docUrl: 'https://platform.deepseek.com/api_keys',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    wire: 'openai',
    envVars: ['GROQ_API_KEY'],
    docUrl: 'https://console.groq.com/keys',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    wire: 'openai',
    envVars: ['MISTRAL_API_KEY'],
    docUrl: 'https://console.mistral.ai/api-keys',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
  },
  {
    id: 'togetherai',
    displayName: 'Together AI',
    wire: 'openai',
    envVars: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
    docUrl: 'https://api.together.xyz/settings/api-keys',
    defaultBaseUrl: 'https://api.together.xyz/v1',
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras',
    wire: 'openai',
    envVars: ['CEREBRAS_API_KEY'],
    docUrl: 'https://cloud.cerebras.ai',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
  },
  {
    id: 'perplexity',
    displayName: 'Perplexity',
    wire: 'openai',
    envVars: ['PERPLEXITY_API_KEY'],
    docUrl: 'https://www.perplexity.ai/settings/api',
    defaultBaseUrl: 'https://api.perplexity.ai',
  },
  {
    id: 'xai',
    displayName: 'xAI',
    wire: 'openai',
    envVars: ['XAI_API_KEY', 'X_AI_API_KEY'],
    docUrl: 'https://console.x.ai',
    defaultBaseUrl: 'https://api.x.ai/v1',
  },
  {
    id: 'moonshot-ai',
    displayName: 'Kimi (Moonshot AI)',
    wire: 'kimi',
    envVars: ['MOONSHOT_API_KEY'],
    docUrl: 'https://platform.moonshot.ai/console/api-keys',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
  },
  {
    id: 'moonshot-cn',
    displayName: 'Kimi (Moonshot · platform.kimi.com)',
    wire: 'kimi',
    envVars: ['MOONSHOT_API_KEY'],
    docUrl: 'https://platform.moonshot.cn/console/api-keys',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
  },
  {
    id: 'deepinfra',
    displayName: 'DeepInfra',
    wire: 'openai',
    envVars: ['DEEPINFRA_API_KEY', 'DEEPINFRA_TOKEN'],
    docUrl: 'https://deepinfra.com/dash/api_keys',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
  },
  {
    id: 'venice',
    displayName: 'Venice',
    wire: 'openai',
    envVars: ['VENICE_API_KEY'],
    docUrl: 'https://venice.ai/settings/api',
    defaultBaseUrl: 'https://api.venice.ai/api/v1',
  },
  {
    id: 'qwen',
    displayName: 'Qwen (Alibaba)',
    wire: 'openai',
    envVars: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    docUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    id: 'zai',
    displayName: 'Zhipu (Z.ai)',
    wire: 'openai',
    envVars: ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'BIGMODEL_API_KEY'],
    docUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    wire: 'openai',
    envVars: ['MINIMAX_API_KEY'],
    docUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    defaultBaseUrl: 'https://api.minimax.io/v1',
  },
  {
    id: 'vercel',
    displayName: 'Vercel AI Gateway',
    wire: 'openai',
    envVars: ['AI_GATEWAY_API_KEY', 'VERCEL_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY'],
    docUrl: 'https://vercel.com/docs/ai-gateway',
    defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1',
  },
  {
    id: 'ollama',
    displayName: 'Ollama (local)',
    wire: 'openai',
    envVars: ['OLLAMA_API_KEY'],
    docUrl: 'https://ollama.com',
    defaultBaseUrl: 'http://localhost:11434/v1',
    local: true,
  },
  {
    id: 'lm-studio',
    displayName: 'LM Studio (local)',
    wire: 'openai',
    envVars: ['LMSTUDIO_API_KEY', 'LM_STUDIO_API_KEY'],
    docUrl: 'https://lmstudio.ai/docs/app/api',
    defaultBaseUrl: 'http://localhost:1234/v1',
    local: true,
  },
  {
    id: 'llamacpp',
    displayName: 'llama.cpp server (local)',
    wire: 'openai',
    envVars: ['LLAMACPP_API_KEY'],
    docUrl: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    local: true,
  },
  {
    id: 'vllm',
    displayName: 'vLLM server (local)',
    wire: 'openai',
    envVars: ['VLLM_API_KEY'],
    docUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
    defaultBaseUrl: 'http://localhost:8000/v1',
    local: true,
  },
  {
    id: 'textgen-webui',
    displayName: 'Text generation web UI (local)',
    wire: 'openai',
    envVars: ['TEXTGEN_WEBUI_API_KEY'],
    docUrl: 'https://github.com/oobabooga/text-generation-webui/wiki/12-%E2%80%90-OpenAI-API',
    defaultBaseUrl: 'http://127.0.0.1:5000/v1',
    local: true,
  },
  {
    id: 'localai',
    displayName: 'LocalAI (local)',
    wire: 'openai',
    envVars: ['LOCALAI_API_KEY'],
    docUrl: 'https://localai.io/features/endpoints/',
    defaultBaseUrl: 'http://localhost:8080/v1',
    local: true,
  },
];

/** Lowercase id / alias → definition. Aliases cover models.dev naming drift. */
const BY_ID: ReadonlyMap<string, ApiKeyProviderDefinition> = new Map(
  API_KEY_PROVIDERS.flatMap((def): readonly (readonly [string, ApiKeyProviderDefinition])[] => {
    const keys: (readonly [string, ApiKeyProviderDefinition])[] = [[def.id.toLowerCase(), def]];
    for (const alias of aliasesFor(def.id)) {
      if (!BY_ID_HAS(keys, alias)) keys.push([alias, def]);
    }
    return keys;
  }),
);

function BY_ID_HAS(keys: readonly (readonly [string, ApiKeyProviderDefinition])[], key: string): boolean {
  return keys.some(([k]) => k === key);
}

function aliasesFor(id: string): readonly string[] {
  switch (id.toLowerCase()) {
    case 'google':
      return ['gemini'];
    case 'togetherai':
      return ['together'];
    case 'lm-studio':
      return ['lmstudio', 'lm_studio'];
    case 'textgen-webui':
      return ['text-generation-webui', 'oobabooga'];
    case 'llamacpp':
      return ['llama-cpp', 'llama.cpp', 'llama-server'];
    case 'vllm':
      return ['v-llm'];
    case 'localai':
      return ['local-ai'];
    case 'moonshot-ai':
      return ['moonshot', 'kimi', 'kimi-moonshot'];
    case 'moonshot-cn':
      return ['kimi-cn', 'moonshot.cn'];
    case 'vercel':
      return ['v0', 'ai-gateway', 'vercel-ai-gateway'];
    case 'openai':
      return ['gpt'];
    case 'anthropic':
      return ['claude'];
    default:
      return [];
  }
}

/** Case-insensitive lookup; understands common aliases (`gemini`, `together`, …). */
export function getApiKeyProvider(id: string): ApiKeyProviderDefinition | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

/** Whether the id names a known API-key provider (aliases included). */
export function isApiKeyProviderId(id: string): boolean {
  return BY_ID.has(id.trim().toLowerCase());
}

/** First non-empty env value for the provider, or `undefined`. */
export function resolveApiKeyFromEnv(
  definition: ApiKeyProviderDefinition,
  env: NodeJS.Dict<string> = process.env,
): string | undefined {
  for (const name of definition.envVars) {
    const value = env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

/** Default base URL for a provider id, or `undefined` when unknown. */
export function defaultBaseUrlForProvider(id: string): string | undefined {
  return getApiKeyProvider(id)?.defaultBaseUrl;
}

/**
 * Actionable missing-credential message: names the env var(s) and where to get
 * a key. Local providers note that no key is required.
 */
export function describeMissingApiKey(
  definition: ApiKeyProviderDefinition,
  providerName?: string,
): string {
  const name = providerName ?? definition.displayName;
  const envs = definition.envVars.join(', ');
  const suffix = definition.local === true ? ' (optional for local servers)' : '';
  return (
    `${name}: API key is required. Set ${envs}${suffix}, pass it as the provider apiKey, ` +
    `or run an OAuth login. Get a key at ${definition.docUrl}.`
  );
}
