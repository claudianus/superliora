/**
 * Storage settings glance — live home + session retention paths (SSOT §9.2).
 */

import { join } from 'node:path';

import { SUPERLIORA_HOME_ENV } from '#/constant/app';

export const MAIN_AGENT_ID = 'main';

/** Home override — entire data tree relocates before first harness init. */
export const STORAGE_HOME_TIP =
  `${SUPERLIORA_HOME_ENV} — override default ~/.superliora before launch. Relocates config, sessions, cache, logs, credentials, and managed tools. Status panel shows whether the override is active.`;

/** Session retention — transcripts, journal, tool-results; no auto-purge yet. */
export const STORAGE_RETENTION_TIP =
  'Session retention: transcripts under <home>/sessions/<workdir-bucket>/<id>/ · durable journal agents/*/wire.jsonl · cleared tool receipts agents/main/tool-results/. Liora Memory lives in memory/liora-memory.sqlite with records/ as a recovery mirror. Resume via session picker · export via `liora export`.';

/** Log level — interactive TUI stderr vs server daemon flag. */
export const STORAGE_LOGS_TIP =
  'Logs: interactive TUI writes stderr + ~/.superliora/logs when enabled. Server daemon: `liora server run --log-level info|debug|silent`. No log-level toggle in Settings until storage slice lands.';

export interface StoragePaths {
  readonly homeDir: string;
  readonly configPath: string;
  readonly sessionsDir: string;
  readonly journalPath: string;
  readonly toolResultsDir: string;
  readonly sessionDir?: string;
}

export interface StorageGlanceInput extends StoragePaths {
  readonly homeFromEnv: boolean;
  readonly logDir: string;
  readonly workDir?: string;
  readonly sessionCount?: number;
}

export function resolveStoragePaths(input: {
  readonly homeDir: string;
  readonly configPath?: string;
  readonly sessionDir?: string;
}): StoragePaths {
  const homeDir = input.homeDir;
  const configPath = input.configPath ?? join(homeDir, 'config.toml');
  const sessionsDir = join(homeDir, 'sessions');
  const sessionDir = input.sessionDir?.trim();
  const hasSessionDir = sessionDir !== undefined && sessionDir.length > 0;
  const journalPath = hasSessionDir
    ? join(sessionDir, 'agents', MAIN_AGENT_ID, 'wire.jsonl')
    : join(sessionsDir, '<workdir-bucket>/<session-id>/agents/*/wire.jsonl');
  const toolResultsDir = hasSessionDir
    ? join(sessionDir, 'agents', MAIN_AGENT_ID, 'tool-results')
    : join(sessionsDir, '<workdir-bucket>/<session-id>/agents/main/tool-results');
  return {
    homeDir,
    configPath,
    sessionsDir,
    journalPath,
    toolResultsDir,
    ...(hasSessionDir ? { sessionDir } : {}),
  };
}

export function buildStorageSettingsLines(input: StorageGlanceInput): readonly string[] {
  const homeLine = input.homeFromEnv
    ? `Home: ${input.homeDir} (SUPERLIORA_HOME override).`
    : `Home: ${input.homeDir} (default ~/.superliora).`;

  const retentionLine =
    input.sessionCount === undefined
      ? 'Session retention: open a session to count indexed transcripts for this workspace.'
      : `Session retention: ${String(input.sessionCount)} session(s) indexed for ${input.workDir ?? 'this workspace'}.`;

  const sessionDirLine =
    input.sessionDir !== undefined
      ? `Current session dir: ${input.sessionDir}`
      : 'Current session dir: (none — resume or start a session for live paths).';

  return [
    '── Storage (read-only) ───────────────────────',
    'Local data layout — Sovereign Reform §9.2.',
    '',
    '── Status ───────────────────────────────────',
    homeLine,
    `Config: ${input.configPath}`,
    `Sessions: ${input.sessionsDir}/`,
    `Journal: ${input.journalPath}`,
    `Tool results: ${input.toolResultsDir}/`,
    `Logs: ${input.logDir}/ (CLI diagnostics; server uses --log-level).`,
    sessionDirLine,
    retentionLine,
    '',
    '── Home layout ──────────────────────────────',
    '· skills/ · skills-state.json · cache/ · logs/ · user-history/',
    '· memory/liora-memory.sqlite + records/ · episodes/ (migration input only) · credentials/ · mcp.json',
    '· updates/ (CLI auto-update state) · bin/ (managed tools)',
    '· Override entire tree: export SUPERLIORA_HOME before launch',
    '',
    '── Session retention ──────────────────────────',
    '· Transcripts + agent state under <home>/sessions/<workdir-bucket>/<id>/',
    '· Durable turn journal: agents/*/wire.jsonl (replay + export source)',
    '· Cleared tool output receipts: agents/main/tool-results/',
    '· Resume via session picker · export via `liora export`',
    '· No automatic purge in Settings yet — manual cleanup by deleting dirs',
    '· Goal queue artifacts: <sessionDir>/goal-queue.json when Mission active',
    '',
    '── Log level ────────────────────────────────',
    '· Interactive TUI: stderr + ~/.superliora/logs (when enabled)',
    '· Server daemon: `liora server run --log-level info|debug|silent`',
    '',
    'No retention policy or log-level toggles here until storage slice lands.',
  ];
}
