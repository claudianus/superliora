import type {
  ResearchSearchProviderConfig,
  ResearchSearchProviderKind,
} from '#/config/schema';

const ENV_KEY_MAP: ReadonlyArray<{
  readonly kind: ResearchSearchProviderKind;
  readonly envs: readonly string[];
}> = [
  { kind: 'brave', envs: ['BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY'] },
  { kind: 'tavily', envs: ['TAVILY_API_KEY'] },
  { kind: 'exa', envs: ['EXA_API_KEY'] },
  { kind: 'serper', envs: ['SERPER_API_KEY', 'SERPER_DEV_API_KEY'] },
];

export function detectSearchProviderEnvKeys(
  env: NodeJS.ProcessEnv = process.env,
): ResearchSearchProviderConfig[] {
  const detected: ResearchSearchProviderConfig[] = [];
  for (const entry of ENV_KEY_MAP) {
    for (const envName of entry.envs) {
      const value = env[envName]?.trim();
      if (value !== undefined && value.length > 0) {
        detected.push({
          kind: entry.kind,
          apiKeyEnv: envName,
          label: entry.kind,
        });
        break;
      }
    }
  }
  return detected;
}

export function resolveResearchApiKey(input: {
  readonly apiKey?: string | undefined;
  readonly apiKeyEnv?: string | undefined;
  readonly apiKeys?: readonly string[] | undefined;
  readonly env?: NodeJS.ProcessEnv;
}): string | undefined {
  const env = input.env ?? process.env;
  const candidates: string[] = [];
  if (input.apiKey !== undefined) candidates.push(input.apiKey);
  if (input.apiKeys !== undefined) candidates.push(...input.apiKeys);
  for (const raw of candidates) {
    const resolved = resolveKeyRef(raw, env);
    if (resolved !== undefined) return resolved;
  }
  if (input.apiKeyEnv !== undefined) {
    const fromEnv = env[input.apiKeyEnv]?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  }
  return undefined;
}

function resolveKeyRef(raw: string, env: NodeJS.ProcessEnv): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const envRef = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
  if (envRef?.[1] !== undefined) {
    const value = env[envRef[1]]?.trim();
    return value !== undefined && value.length > 0 ? value : undefined;
  }
  return trimmed;
}
