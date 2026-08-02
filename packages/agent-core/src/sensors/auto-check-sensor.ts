/**
 * Opt-in auto-check productization (Loop16a + Loop19a).
 *
 * Loop16a: when `SUPERLIORA_AUTO_CHECK=1`, PostToolUse / Stop / Goal soft tips
 * upgrade to a machine-actionable RunProjectChecks directive (no process).
 *
 * Loop19a: when `SUPERLIORA_AUTO_CHECK_SPAWN=1`, the step loop may actually
 * invoke RunProjectChecks after a successful file mutation — rate-limited —
 * and append a compact result block. Default remains off (cost/permission).
 */

export const AUTO_CHECK_ENV = 'SUPERLIORA_AUTO_CHECK' as const;
/** Compat alias used in harness boards / docs. */
export const AUTO_CHECK_ENV_ALIAS = 'auto_check' as const;
/** Opt-in true process spawn (Loop19a). Independent of directive env. */
export const AUTO_CHECK_SPAWN_ENV = 'SUPERLIORA_AUTO_CHECK_SPAWN' as const;

export const AUTO_CHECK_PREFIX = 'AUTO_CHECK:' as const;
export const AUTO_CHECK_SPAWN_PREFIX = 'AUTO_CHECK_SPAWN:' as const;

/** Min wall time between spawns (session-wide). */
export const AUTO_CHECK_SPAWN_MIN_INTERVAL_MS = 30_000;
/** Cap spawns per agent lifetime (session). */
export const AUTO_CHECK_SPAWN_MAX_PER_SESSION = 8;
/** Default checks for spawn (cheap suite). */
export const AUTO_CHECK_SPAWN_DEFAULT_CHECKS = ['test', 'typecheck'] as const;

export function isAutoCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnv(env[AUTO_CHECK_ENV]) || isTruthyEnv(env[AUTO_CHECK_ENV_ALIAS]);
}

export function isAutoCheckSpawnEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnv(env[AUTO_CHECK_SPAWN_ENV]);
}

function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export interface AutoCheckDirectiveInput {
  readonly packageDir?: string | undefined;
  /** Default: test + typecheck (cheaper than full build suite). */
  readonly checks?: readonly string[] | undefined;
}

const DEFAULT_AUTO_CHECKS = AUTO_CHECK_SPAWN_DEFAULT_CHECKS;

/**
 * Machine-actionable next-step line for RunProjectChecks.
 * Always starts with {@link AUTO_CHECK_PREFIX} so callers can detect it.
 */
export function formatAutoCheckDirective(input: AutoCheckDirectiveInput = {}): string {
  const checks = input.checks ?? DEFAULT_AUTO_CHECKS;
  const checksJson = JSON.stringify([...checks]);
  if (input.packageDir !== undefined && input.packageDir.length > 0) {
    return (
      `${AUTO_CHECK_PREFIX} call RunProjectChecks now with ` +
      `packageDir=${input.packageDir} checks=${checksJson} ` +
      `(env ${AUTO_CHECK_ENV}=1 — do not claim done until green).`
    );
  }
  return (
    `${AUTO_CHECK_PREFIX} call RunProjectChecks now with checks=${checksJson} ` +
    `(packageDir when the change set is single-package; env ${AUTO_CHECK_ENV}=1 — do not claim done until green).`
  );
}

/**
 * When auto-check is enabled, append the directive under a soft nudge.
 * When disabled, returns `base` unchanged.
 */
export function withAutoCheckDirective(
  base: string,
  packageDir?: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isAutoCheckEnabled(env)) return base;
  if (base.includes(AUTO_CHECK_PREFIX)) return base;
  return `${base}\n${formatAutoCheckDirective({ packageDir })}`;
}

/**
 * Prefer unanimous packageDir from recent mutation records for auto-check scope.
 */
export function resolveAutoCheckPackageDir(
  packageDirs: readonly (string | undefined)[],
): string | undefined {
  const present = packageDirs.filter(
    (dir): dir is string => typeof dir === 'string' && dir.length > 0,
  );
  if (present.length === 0) return undefined;
  if (!present.every((d) => d === present[0])) return undefined;
  return present[0];
}

// ---------------------------------------------------------------------------
// Loop19a — rate-limited spawn decision + result formatting
// ---------------------------------------------------------------------------

export interface AutoCheckSpawnState {
  lastSpawnAtMs?: number | undefined;
  spawnCount: number;
  /** Loop20b: last spawn finished without tool error (cleared pending mutations). */
  lastSpawnOk?: boolean | undefined;
}

export function createAutoCheckSpawnState(): AutoCheckSpawnState {
  return { spawnCount: 0 };
}

export type AutoCheckSpawnDecision =
  | {
      readonly spawn: true;
      readonly packageDir?: string | undefined;
      readonly checks: readonly string[];
    }
  | {
      readonly spawn: false;
      readonly reason: string;
    };

export interface DecideAutoCheckSpawnInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly state: AutoCheckSpawnState;
  /** When set, only spawn for single-package scopes (safer). */
  readonly packageDir?: string | undefined;
  /** Require packageDir for spawn (default true — avoid repo-wide runs). */
  readonly requirePackageDir?: boolean;
  readonly nowMs?: number;
  readonly minIntervalMs?: number;
  readonly maxPerSession?: number;
  readonly checks?: readonly string[];
}

/**
 * Pure decision: whether the step-loop may invoke RunProjectChecks now.
 * Does not mutate state — caller records a spawn via {@link recordAutoCheckSpawn}.
 */
export function decideAutoCheckSpawn(input: DecideAutoCheckSpawnInput): AutoCheckSpawnDecision {
  const env = input.env ?? process.env;
  if (!isAutoCheckSpawnEnabled(env)) {
    return { spawn: false, reason: `${AUTO_CHECK_SPAWN_ENV} off` };
  }
  const requirePackageDir = input.requirePackageDir !== false;
  if (requirePackageDir && (input.packageDir === undefined || input.packageDir.length === 0)) {
    return { spawn: false, reason: 'packageDir required' };
  }
  const max = input.maxPerSession ?? AUTO_CHECK_SPAWN_MAX_PER_SESSION;
  if (input.state.spawnCount >= max) {
    return { spawn: false, reason: `session cap ${String(max)}` };
  }
  const nowMs = input.nowMs ?? Date.now();
  const minInterval = input.minIntervalMs ?? AUTO_CHECK_SPAWN_MIN_INTERVAL_MS;
  const last = input.state.lastSpawnAtMs;
  if (last !== undefined && nowMs - last < minInterval) {
    return {
      spawn: false,
      reason: `cooldown ${String(minInterval)}ms (last ${String(nowMs - last)}ms ago)`,
    };
  }
  return {
    spawn: true,
    packageDir: input.packageDir,
    checks: input.checks ?? [...AUTO_CHECK_SPAWN_DEFAULT_CHECKS],
  };
}

export function recordAutoCheckSpawn(
  state: AutoCheckSpawnState,
  nowMs: number = Date.now(),
  options?: { readonly ok?: boolean },
): void {
  state.lastSpawnAtMs = nowMs;
  state.spawnCount += 1;
  if (options?.ok !== undefined) {
    state.lastSpawnOk = options.ok;
  }
}

/** Loop20b: stop sensor may suppress mutation-only nudges after a green spawn. */
export function wasRecentAutoCheckSpawnOk(
  state: AutoCheckSpawnState,
  nowMs: number = Date.now(),
  windowMs: number = AUTO_CHECK_SPAWN_MIN_INTERVAL_MS,
): boolean {
  if (state.lastSpawnOk !== true) return false;
  const at = state.lastSpawnAtMs;
  if (at === undefined) return false;
  return nowMs - at <= windowMs;
}

export interface FormatAutoCheckSpawnResultInput {
  readonly packageDir?: string | undefined;
  readonly checks: readonly string[];
  readonly isError: boolean;
  readonly outputText: string;
  /** Truncate body for tool-result append (default 1200). */
  readonly maxBodyChars?: number;
}

/** Compact block appended under the PostToolUse mutation nudge. */
export function formatAutoCheckSpawnResult(input: FormatAutoCheckSpawnResultInput): string {
  const scope =
    input.packageDir !== undefined && input.packageDir.length > 0
      ? `packageDir=${input.packageDir}`
      : 'packageDir=(repo root)';
  const checksJson = JSON.stringify([...input.checks]);
  const status = input.isError ? 'FAILED' : 'OK';
  const max = input.maxBodyChars ?? 1200;
  let body = input.outputText.trim();
  if (body.length > max) {
    body = `${body.slice(0, max)}\n… [truncated ${String(body.length - max)} chars]`;
  }
  return [
    `${AUTO_CHECK_SPAWN_PREFIX} RunProjectChecks ${status} (${scope}, checks=${checksJson})`,
    body.length > 0 ? body : '(empty output)',
  ].join('\n');
}

export function appendAutoCheckSpawnBlock(
  resultOutput: string,
  spawnBlock: string,
): string {
  if (resultOutput.includes(AUTO_CHECK_SPAWN_PREFIX)) return resultOutput;
  return `${resultOutput}\n\n${spawnBlock}`;
}
