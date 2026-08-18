/**
 * Diagnostic session for daily `liora --debug` use.
 *
 * Off by default so normal launches stay light. When on (`--debug` or
 * `SUPERLIORA_DEBUG=1`): NDJSON breadcrumbs, renderer frame trace, stdio
 * persist, scroll-hang sampling, step timing, startup traces, and info-level
 * session logs under ~/.superliora/logs. Never throw into a product path.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  SUPERLIORA_DEBUG_ENV,
  SUPERLIORA_DEBUG_LOG_ENV,
  SUPERLIORA_DEBUG_LOG_FILE_NAME,
  SUPERLIORA_HOME_ENV,
  SUPERLIORA_LOG_DIR_NAME,
} from '#/constant/app';
import { getLogDir } from '#/utils/paths';

const MOTION_KILLERS = ['CI', 'GITHUB_ACTIONS', 'NO_COLOR', 'FORCE_COLOR'] as const;
const FALLBACK_TERM = 'xterm-256color';

const SECRET_KEY = /key|token|secret|password|authorization|cookie|api[_-]?key/i;
const MAX_STRING = 4000;

export interface DebugLogEntry {
  readonly location: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

function truthyDebugEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

export function isDebugSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthyDebugEnv(env[SUPERLIORA_DEBUG_ENV]);
}

function logDirFor(env: NodeJS.ProcessEnv): string {
  const home = env[SUPERLIORA_HOME_ENV]?.trim();
  if (home !== undefined && home.length > 0) return join(home, SUPERLIORA_LOG_DIR_NAME);
  return getLogDir();
}

/**
 * Apply `liora --debug`: keep the operator home, raise log level, and lift
 * CI/NO_COLOR/TERM=dumb leftovers so motion still matches a real terminal.
 */
export function applyDebugCliFlag(env: NodeJS.ProcessEnv = process.env): void {
  env[SUPERLIORA_DEBUG_ENV] = '1';
  env['SUPERLIORA_LOG_LEVEL'] = 'info';
  for (const key of MOTION_KILLERS) delete env[key];
  const term = env['TERM']?.trim();
  if (term === undefined || term.length === 0 || term === 'dumb') {
    env['TERM'] = FALLBACK_TERM;
  }
  if ((env[SUPERLIORA_DEBUG_LOG_ENV]?.trim() ?? '').length === 0) {
    env[SUPERLIORA_DEBUG_LOG_ENV] = join(logDirFor(env), SUPERLIORA_DEBUG_LOG_FILE_NAME);
  }
  if ((env['SUPERLIORA_TUI_STARTUP_TRACE']?.trim() ?? '').length === 0) {
    env['SUPERLIORA_TUI_STARTUP_TRACE'] = join(logDirFor(env), 'startup-trace.log');
  }
}

export function resolveDebugLogPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!isDebugSession(env)) return undefined;
  const explicit = env[SUPERLIORA_DEBUG_LOG_ENV]?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return join(getLogDir(), SUPERLIORA_DEBUG_LOG_FILE_NAME);
}

function redactJson(_key: string, value: unknown): unknown {
  if (SECRET_KEY.test(_key)) return '***';
  if (typeof value === 'string' && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`;
  }
  return value;
}

/** Append one NDJSON line. No-op unless `SUPERLIORA_DEBUG` is on. */
export function writeDebugLog(entry: DebugLogEntry): void {
  const logPath = resolveDebugLogPath();
  if (logPath === undefined) return;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `${JSON.stringify(
        {
          t: Date.now(),
          location: entry.location,
          message: entry.message,
          data: entry.data,
        },
        redactJson,
      )}\n`,
      'utf8',
    );
  } catch {
    // Diagnostics must never break the TUI or harness.
  }
}
