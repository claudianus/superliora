import { resolveGlobalLogPath } from './logger';
import type { LogLevel, LoggingConfig } from './types';

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_GLOBAL_MAX_BYTES = 6 * 1024 * 1024; // 6 MB
export const DEFAULT_GLOBAL_FILES = 5; // 6 MB x 5 = 30 MB
export const DEFAULT_SESSION_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_SESSION_FILES = 3; // 5 MB x 3 = 15 MB

export interface ResolveLoggingInput {
  readonly homeDir: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

/**
 * Build the runtime `LoggingConfig` from env vars + defaults.
 *
 * v1 deliberately does not read `config.toml [logging]` — the schema is in
 * flux and reading it adds a startup-time failure surface. Users who need to
 * override the defaults set env vars:
 *
 *   SUPERLIORA_LOG_LEVEL=debug   (alias: KIMI_LOG_LEVEL)
 *   SUPERLIORA_LOG_GLOBAL_MAX_BYTES / SUPERLIORA_LOG_GLOBAL_FILES
 *   SUPERLIORA_LOG_SESSION_MAX_BYTES / SUPERLIORA_LOG_SESSION_FILES
 *   SUPERLIORA_LOG_MIRROR_WARN=0  to disable warn/error global mirror
 *
 * Legacy `KIMI_LOG_*` names remain supported for compatibility.
 */
export function resolveLoggingConfig(input: ResolveLoggingInput): LoggingConfig {
  const env = input.env ?? process.env;
  return {
    level: parseLevel(envValue(env, 'SUPERLIORA_LOG_LEVEL', 'KIMI_LOG_LEVEL')) ?? DEFAULT_LOG_LEVEL,
    globalLogPath: resolveGlobalLogPath(input.homeDir),
    globalMaxBytes:
      parsePositiveInt(envValue(env, 'SUPERLIORA_LOG_GLOBAL_MAX_BYTES', 'KIMI_LOG_GLOBAL_MAX_BYTES')) ??
      DEFAULT_GLOBAL_MAX_BYTES,
    globalFiles:
      parsePositiveInt(envValue(env, 'SUPERLIORA_LOG_GLOBAL_FILES', 'KIMI_LOG_GLOBAL_FILES')) ??
      DEFAULT_GLOBAL_FILES,
    sessionMaxBytes:
      parsePositiveInt(
        envValue(env, 'SUPERLIORA_LOG_SESSION_MAX_BYTES', 'KIMI_LOG_SESSION_MAX_BYTES'),
      ) ?? DEFAULT_SESSION_MAX_BYTES,
    sessionFiles:
      parsePositiveInt(envValue(env, 'SUPERLIORA_LOG_SESSION_FILES', 'KIMI_LOG_SESSION_FILES')) ??
      DEFAULT_SESSION_FILES,
    mirrorSessionWarnToGlobal: parseBool(
      envValue(env, 'SUPERLIORA_LOG_MIRROR_WARN', 'KIMI_LOG_MIRROR_WARN'),
      true,
    ),
  };
}

function envValue(
  env: NodeJS.ProcessEnv,
  primary: string,
  legacy: string,
): string | undefined {
  const a = env[primary];
  if (a !== undefined && a.trim().length > 0) return a;
  const b = env[legacy];
  if (b !== undefined && b.trim().length > 0) return b;
  return undefined;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.toLowerCase().trim();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return fallback;
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  if (value === undefined) return undefined;
  const v = value.toLowerCase().trim();
  if (v === 'off' || v === 'error' || v === 'warn' || v === 'info' || v === 'debug') return v;
  return undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
