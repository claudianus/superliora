/**
 * Optional process-sandbox enforcement (2nd axis).
 *
 * `sandboxProfile` is what is allowed. `sandboxEnforcement` is how hard:
 * lexical (default) vs process (Docker when present, else Windows Job Object
 * tree — not a filesystem jail).
 *
 * Priority (highest first):
 * CLI / SUPERLIORA_SANDBOX_ENFORCEMENT → local.toml workspace.sandbox_enforcement →
 * user config.toml sandboxEnforcement → session metadata.custom.sandboxEnforcement → lexical
 *
 * SUPERLIORA_NO_PROCESS_SANDBOX / --no-process-sandbox skip process mode.
 */

export type SandboxEnforcement = 'lexical' | 'process';

export const SANDBOX_ENFORCEMENTS = ['lexical', 'process'] as const satisfies readonly SandboxEnforcement[];

export const DEFAULT_SANDBOX_ENFORCEMENT: SandboxEnforcement = 'lexical';

export const SUPERLIORA_SANDBOX_ENFORCEMENT_ENV = 'SUPERLIORA_SANDBOX_ENFORCEMENT';
export const SUPERLIORA_NO_PROCESS_SANDBOX_ENV = 'SUPERLIORA_NO_PROCESS_SANDBOX';

export function isSandboxEnforcement(value: unknown): value is SandboxEnforcement {
  return value === 'lexical' || value === 'process';
}

export function parseSandboxEnforcement(value: unknown): SandboxEnforcement | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (isSandboxEnforcement(normalized)) return normalized;
  return undefined;
}

export function isNoProcessSandbox(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[SUPERLIORA_NO_PROCESS_SANDBOX_ENV]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export interface SandboxEnforcementSources {
  readonly cli?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> | undefined;
  readonly localToml?: string | undefined;
  readonly userConfig?: string | undefined;
  readonly sessionMetadata?: string | undefined;
  readonly noProcessCli?: boolean | undefined;
}

export interface ResolveSandboxEnforcementResult {
  readonly enforcement: SandboxEnforcement;
  readonly source:
    | 'cli'
    | 'env'
    | 'localToml'
    | 'userConfig'
    | 'sessionMetadata'
    | 'default';
  readonly warning?: string | undefined;
  readonly noProcess?: boolean;
}

export function resolveSandboxEnforcementFromSources(
  sources: SandboxEnforcementSources = {},
): ResolveSandboxEnforcementResult {
  const warnings: string[] = [];
  const env = sources.env ?? process.env;
  const noProcess = sources.noProcessCli === true || isNoProcessSandbox(env);

  const tryLayer = (
    raw: string | undefined,
    source: ResolveSandboxEnforcementResult['source'],
  ): ResolveSandboxEnforcementResult | undefined => {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = parseSandboxEnforcement(trimmed);
    if (parsed !== undefined) {
      return { enforcement: parsed, source, noProcess };
    }
    if (source === 'cli' || source === 'env') {
      warnings.push(
        `Ignoring invalid ${source === 'cli' ? '--sandbox-enforcement' : SUPERLIORA_SANDBOX_ENFORCEMENT_ENV} value "${trimmed}" (expected lexical|process).`,
      );
    }
    return undefined;
  };

  const envRaw = sources.env === undefined ? undefined : sources.env[SUPERLIORA_SANDBOX_ENFORCEMENT_ENV];

  const layers: Array<readonly [string | undefined, ResolveSandboxEnforcementResult['source']]> = [
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
    ? {
        enforcement: DEFAULT_SANDBOX_ENFORCEMENT,
        source: 'default',
        warning: warnings.join(' '),
        noProcess,
      }
    : { enforcement: DEFAULT_SANDBOX_ENFORCEMENT, source: 'default', noProcess };
}
