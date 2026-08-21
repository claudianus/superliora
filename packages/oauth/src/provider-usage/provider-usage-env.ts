/** Env keys SuperLiora already documents for catalog API providers. */
export const ENV_USAGE_PROVIDERS: readonly {
  readonly key: string;
  readonly envs: readonly string[];
}[] = [
  { key: 'openrouter', envs: ['OPENROUTER_API_KEY'] },
  { key: 'deepseek', envs: ['DEEPSEEK_API_KEY'] },
];

export function detectEnvUsageProviderKeys(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const keys: string[] = [];
  for (const entry of ENV_USAGE_PROVIDERS) {
    if (entry.envs.some((name) => (env[name] ?? '').trim().length > 0)) {
      keys.push(entry.key);
    }
  }
  return keys;
}

export function envUsageAccessToken(
  providerKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const entry = ENV_USAGE_PROVIDERS.find((item) => item.key === providerKey);
  if (entry === undefined) return undefined;
  for (const name of entry.envs) {
    const value = env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}
