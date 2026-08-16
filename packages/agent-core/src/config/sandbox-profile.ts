/**
 * Product path-sandbox profile resolution.
 *
 * This is a lexical path guard for file tools — not OS isolation
 * (Docker / Job Object / bubblewrap / Landlock).
 *
 * Priority (highest first):
 * CLI / SUPERLIORA_SANDBOX → local.toml workspace.sandbox_profile →
 * user config.toml sandboxProfile → session metadata.custom.sandboxProfile → off
 */

import type { SandboxProfile } from '../tools/policies/path-access';

export const SANDBOX_PROFILES = ['off', 'workspace', 'read-only'] as const satisfies readonly SandboxProfile[];

export const DEFAULT_SANDBOX_PROFILE: SandboxProfile = 'off';

export const SUPERLIORA_SANDBOX_ENV = 'SUPERLIORA_SANDBOX';

export function isSandboxProfile(value: unknown): value is SandboxProfile {
  return value === 'off' || value === 'workspace' || value === 'read-only';
}

/** Parse a raw profile string; invalid values return undefined. */
export function parseSandboxProfile(value: unknown): SandboxProfile | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (isSandboxProfile(normalized)) return normalized;
  return undefined;
}

export interface SandboxProfileSources {
  /** CLI `--sandbox` */
  readonly cli?: string | undefined;
  /** Process env (`SUPERLIORA_SANDBOX`) */
  readonly env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> | undefined;
  /** `.superliora/local.toml` → workspace.sandbox_profile */
  readonly localToml?: string | undefined;
  /** User `config.toml` → sandboxProfile */
  readonly userConfig?: string | undefined;
  /** Session `metadata.custom.sandboxProfile` */
  readonly sessionMetadata?: string | undefined;
}

export interface ResolveSandboxProfileResult {
  readonly profile: SandboxProfile;
  readonly source:
    | 'cli'
    | 'env'
    | 'localToml'
    | 'userConfig'
    | 'sessionMetadata'
    | 'default';
  /** Set when env/cli provided an unusable value. */
  readonly warning?: string | undefined;
}

/**
 * Resolve the effective sandbox profile from layered sources.
 * Invalid non-empty values at a layer are skipped (with warning for env/cli).
 */
export function resolveSandboxProfileFromSources(
  sources: SandboxProfileSources = {},
): ResolveSandboxProfileResult {
  const warnings: string[] = [];

  const tryLayer = (
    raw: string | undefined,
    source: ResolveSandboxProfileResult['source'],
  ): ResolveSandboxProfileResult | undefined => {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = parseSandboxProfile(trimmed);
    if (parsed !== undefined) {
      return { profile: parsed, source };
    }
    if (source === 'cli' || source === 'env') {
      warnings.push(
        `Ignoring invalid ${source === 'cli' ? '--sandbox' : SUPERLIORA_SANDBOX_ENV} value "${trimmed}" (expected off|workspace|read-only).`,
      );
    }
    return undefined;
  };

  const envRaw =
    sources.env === undefined
      ? undefined
      : sources.env[SUPERLIORA_SANDBOX_ENV] ??
        // legacy misspellings are not accepted — only the documented key
        undefined;

  const layers: Array<readonly [string | undefined, ResolveSandboxProfileResult['source']]> = [
    [sources.cli, 'cli'],
    [envRaw, 'env'],
    [sources.localToml, 'localToml'],
    [sources.userConfig, 'userConfig'],
    [sources.sessionMetadata, 'sessionMetadata'],
  ];

  for (const [raw, source] of layers) {
    const hit = tryLayer(raw, source);
    if (hit !== undefined) {
      return warnings.length > 0 ? { ...hit, warning: warnings.join(' ') } : hit;
    }
  }

  return warnings.length > 0
    ? { profile: DEFAULT_SANDBOX_PROFILE, source: 'default', warning: warnings.join(' ') }
    : { profile: DEFAULT_SANDBOX_PROFILE, source: 'default' };
}
