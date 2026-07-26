/**
 * Shell environment secret filter.
 *
 * Child shells should not inherit ambient credentials that match common
 * secret-name patterns. Filtering is by **key name only** — values are never
 * logged or returned for audit. SuperLiora defaults to strip ON (stricter
 * than Grok Build's default-noop excludes).
 */

export type ShellEnvInheritMode = 'all' | 'core' | 'none';

export interface ShellEnvFilterPolicy {
  /**
   * How much of the ambient env to start from before excludes.
   * - `all` (default): full ambient map
   * - `core`: PATH / HOME / USER / LANG / LC_* / TMPDIR only
   * - `none`: empty base (then set/noninteractive overlays only)
   */
  readonly inherit?: ShellEnvInheritMode | undefined;
  /**
   * When true (default), drop keys matching SuperLiora default secret globs
   * (KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL/… — see DEFAULT_SECRET_ENV_SUBSTRINGS).
   */
  readonly stripDefaultSecrets?: boolean | undefined;
  /** Extra case-insensitive substring patterns (without wildcards). */
  readonly excludeSubstrings?: readonly string[] | undefined;
  /** Exact key allowlist that survives exclude rules (case-sensitive names). */
  readonly allowKeys?: readonly string[] | undefined;
  /** Force-set keys after filtering (wins over ambient). */
  readonly set?: Readonly<Record<string, string>> | undefined;
}

export const DEFAULT_SHELL_ENV_FILTER_POLICY: Required<
  Pick<ShellEnvFilterPolicy, 'inherit' | 'stripDefaultSecrets'>
> = {
  inherit: 'all',
  stripDefaultSecrets: true,
};

/**
 * Default secret name substrings (case-insensitive).
 * Kept as short tokens so `API_KEY` / `GH_TOKEN` still match; extended
 * credentials (PASSWORD, BEARER, …) close common ambient-leak gaps.
 */
export const DEFAULT_SECRET_ENV_SUBSTRINGS = [
  'KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'CREDENTIAL',
  'PRIVATE',
  'BEARER',
  'AUTHORIZATION',
  'AUTH_HEADER',
  'WEBHOOK',
  'CLIENT_SECRET',
  'ACCESS_KEY',
  'PRIVATE_KEY',
  'COOKIE',
  'JWT',
  'PASSPHRASE',
  'REFRESH_TOKEN',
  'SIGNING',
  'MNEMONIC',
  'PKCS',
  'CONNECTION_STRING',
  // Connection / service URLs often carry credentials in the value.
  // Match common env key stems only (not bare "URL" which false-positives CDN_URL).
  'DATABASE_URL',
  'MONGO_URI',
  'MONGODB_URI',
  'POSTGRES_URL',
  'POSTGRES_URI',
  'MYSQL_URL',
  'MYSQL_URI',
  'REDIS_URL',
  'REDIS_URI',
  'DATABASE_URI',
  'DB_URL',
  'DB_URI',
  // Short DB URL stems (PGURL/SUPABASE_URL) — not bare URL.
  'PGURL',
  'PG_URL',
  'SUPABASE_URL',
  'SERVICE_ROLE',
  'SERVICE_KEY',
] as const;

const CORE_ENV_EXACT = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SHELL',
  'TERM',
  'PWD',
  'OLDPWD',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
]);

function isCoreEnvKey(key: string): boolean {
  if (CORE_ENV_EXACT.has(key)) return true;
  if (key.startsWith('LC_')) return true;
  return false;
}

/**
 * True when the env key name matches a secret-style pattern.
 * Matches {@link DEFAULT_SECRET_ENV_SUBSTRINGS} case-insensitively.
 * Note: false positives like KEYBOARD / TOKENIZER / AUTHORIZATION_CODE
 * are accepted by policy (prefer allowKeys for rare escapes).
 */
export function isSecretEnvKeyName(
  key: string,
  extraSubstrings: readonly string[] = [],
): boolean {
  const upper = key.toUpperCase();
  for (const part of DEFAULT_SECRET_ENV_SUBSTRINGS) {
    if (upper.includes(part)) return true;
  }
  for (const part of extraSubstrings) {
    if (part !== '' && upper.includes(part.toUpperCase())) return true;
  }
  return false;
}

export interface FilterShellEnvResult {
  readonly env: Record<string, string>;
  /** Key names that were stripped (never values). */
  readonly strippedKeys: readonly string[];
}

/**
 * Pure filter: copy ambient env under policy, drop secret-like keys, apply set.
 * Does not mutate the input. Never includes undefined values.
 */
export function filterShellEnv(
  ambient: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  policy: ShellEnvFilterPolicy = {},
): FilterShellEnvResult {
  const inherit = policy.inherit ?? DEFAULT_SHELL_ENV_FILTER_POLICY.inherit;
  const stripDefault =
    policy.stripDefaultSecrets ?? DEFAULT_SHELL_ENV_FILTER_POLICY.stripDefaultSecrets;
  const extra = policy.excludeSubstrings ?? [];
  const allow = new Set(policy.allowKeys ?? []);

  const base: Record<string, string> = {};
  if (inherit !== 'none') {
    for (const [key, value] of Object.entries(ambient)) {
      if (value === undefined) continue;
      if (inherit === 'core' && !isCoreEnvKey(key)) continue;
      base[key] = value;
    }
  }

  const strippedKeys: string[] = [];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (allow.has(key)) {
      env[key] = value;
      continue;
    }
    if (stripDefault && isSecretEnvKeyName(key, extra)) {
      strippedKeys.push(key);
      continue;
    }
    if (!stripDefault && extra.length > 0 && isSecretEnvKeyName(key, extra)) {
      // When default strip is off, still honour explicit exclude substrings.
      if (extra.some((part) => part !== '' && key.toUpperCase().includes(part.toUpperCase()))) {
        strippedKeys.push(key);
        continue;
      }
    }
    env[key] = value;
  }

  if (policy.set !== undefined) {
    for (const [key, value] of Object.entries(policy.set)) {
      env[key] = value;
    }
  }

  strippedKeys.sort();
  return { env, strippedKeys };
}

/**
 * Build the final child-process env for BashTool:
 * ambient → secret filter → noninteractive overrides (always win).
 */
export function buildShellChildEnv(
  ambient: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  noninteractive: Readonly<Record<string, string>>,
  policy: ShellEnvFilterPolicy = {},
): Record<string, string> {
  const filtered = filterShellEnv(ambient, policy);
  return {
    ...filtered.env,
    ...noninteractive,
  };
}
