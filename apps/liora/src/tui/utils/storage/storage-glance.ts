/**
 * Storage settings glance — live home + session retention paths (SSOT §9.2).
 */

import { join } from 'node:path';

export const MAIN_AGENT_ID = 'main';

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
    '· memory/kimi-recall.sqlite + records/ · credentials/ · mcp.json',
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
