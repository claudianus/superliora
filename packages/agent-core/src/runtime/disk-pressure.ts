/**
 * Process-local disk pressure — classify ENOSPC / SQLITE_FULL, probe volumes,
 * run emergency home GC, and format agent / operator signals.
 *
 * No Session coupling. Agent and tools share this module's snapshot.
 */
import { statfs } from 'node:fs/promises';

import { ErrorCodes } from '#/errors/codes';
import type { QuestionItem, QuestionResult } from '#/rpc/sdk-api';
import type { RuntimeDegradedEvent } from '@superliora/protocol';

import {
  collectStorageGarbage,
  formatBytes,
  measureStorageBytes,
  reclaimIdleSessions,
  type StorageBytesReport,
  type StorageGcReport,
} from '#/session/storage-gc';

export type DiskFullKind = 'enospc' | 'edquot' | 'sqlite_full' | 'win32_disk_full';
export type DiskPressureLevel = 'ok' | 'warn' | 'critical';

export const WIN32_ERROR_DISK_FULL = 112;
export const WARN_FREE_BYTES = 512 * 1024 * 1024;
export const WARN_FREE_RATIO = 0.05;
export const CRITICAL_FREE_BYTES = 64 * 1024 * 1024;
export const RECOVERED_FREE_BYTES = 1024 * 1024 * 1024;
export const RECOVERED_FREE_RATIO = 0.1;
export const GZIP_MIN_FREE_BYTES = 1024 * 1024;
export const EMERGENCY_GC_THROTTLE_MS = 30_000;
export const RECLAIM_QUESTION_COOLDOWN_MS = 60_000;
export const IDLE_SESSION_RECLAIM_MS = 7 * 24 * 60 * 60 * 1000;

export const DISK_PRESSURE_DEGRADED_HINT =
  'Disk is full. Harness ran emergency GC of cache/tmp/logs. Check /settings storage or `liora gc`. Do not delete workspace files without confirmation.';

export const DISK_RECLAIM_IDLE_SESSIONS = 'Delete idle sessions (7+ days)';
export const DISK_RECLAIM_TRUNCATE_LOGS = 'Truncate remaining logs';
export const DISK_RECLAIM_RECHECK = 'I freed space myself — recheck';
export const DISK_RECLAIM_WAIT = 'I will free OS space myself';

export interface VolumeSpace {
  readonly path: string;
  readonly freeBytes: number;
  readonly totalBytes: number;
}

export interface DiskPressureSnapshot {
  readonly level: DiskPressureLevel;
  readonly kind?: DiskFullKind;
  readonly volume?: VolumeSpace;
  readonly home?: StorageBytesReport;
  readonly lastGc?: StorageGcReport;
  readonly pendingUserReclaim: boolean;
  readonly recoveredPending: boolean;
  readonly atMs: number;
}

export interface DiskPressureConfig {
  readonly homeDir?: string;
  readonly workDir?: string;
  readonly now?: () => number;
  readonly collect?: typeof collectStorageGarbage;
  readonly measure?: typeof measureStorageBytes;
  readonly probe?: (path: string) => Promise<VolumeSpace | undefined>;
  readonly reclaimIdle?: typeof reclaimIdleSessions;
}

type DiskPressureListener = (snapshot: DiskPressureSnapshot) => void;

const listeners = new Set<DiskPressureListener>();

let config: DiskPressureConfig = {};
let snapshot: DiskPressureSnapshot = {
  level: 'ok',
  pendingUserReclaim: false,
  recoveredPending: false,
  atMs: 0,
};
let lastEmergencyGcMs = 0;
let lastReclaimQuestionMs: number | undefined;
let emergencyGcInFlight: Promise<void> | undefined;

function nowMs(): number {
  return config.now?.() ?? Date.now();
}

function errorCode(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

function errorErrno(error: unknown): number | undefined {
  if (error !== null && typeof error === 'object' && 'errno' in error) {
    const errno = (error as { errno?: unknown }).errno;
    return typeof errno === 'number' ? errno : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyDiskFull(error: unknown): DiskFullKind | undefined {
  const code = errorCode(error);
  if (code === 'ENOSPC') return 'enospc';
  if (code === 'EDQUOT') return 'edquot';
  if (code === 'SQLITE_FULL') return 'sqlite_full';

  const errno = errorErrno(error);
  if (errno === WIN32_ERROR_DISK_FULL || errno === -WIN32_ERROR_DISK_FULL) {
    return 'win32_disk_full';
  }
  if (errno === 28 || errno === -28) return 'enospc';
  if (errno === 122 || errno === -122) return 'edquot';

  const message = errorMessage(error);
  if (/SQLITE_FULL\b/iu.test(message) || /database or disk is full/iu.test(message)) {
    return 'sqlite_full';
  }
  if (/no space left on device/iu.test(message)) return 'enospc';
  if (/there is not enough space on the disk/iu.test(message)) return 'win32_disk_full';
  if (/disk quota exceeded/iu.test(message)) return 'edquot';
  return undefined;
}

export function isDiskFullError(error: unknown): boolean {
  return classifyDiskFull(error) !== undefined;
}

export function isDatabaseFullError(error: unknown): boolean {
  return classifyDiskFull(error) === 'sqlite_full';
}

function toNumber(value: number | bigint): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    return Number(value);
  }
  return value;
}

export async function probeVolumeSpace(path: string): Promise<VolumeSpace | undefined> {
  try {
    const stats = await statfs(path);
    const blockSize = toNumber(stats.bsize);
    const freeBytes = toNumber(stats.bavail) * blockSize;
    const totalBytes = toNumber(stats.blocks) * blockSize;
    if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
      return undefined;
    }
    return { path, freeBytes: Math.max(0, freeBytes), totalBytes };
  } catch {
    return undefined;
  }
}

export function classifyPressureLevel(
  volume: VolumeSpace | undefined,
  writeFailed: boolean,
  previous: DiskPressureLevel,
): DiskPressureLevel {
  if (writeFailed) return 'critical';
  if (volume === undefined) {
    return previous === 'ok' ? 'ok' : previous;
  }
  const ratio = volume.freeBytes / volume.totalBytes;
  if (volume.freeBytes < CRITICAL_FREE_BYTES) return 'critical';
  const recovered =
    volume.freeBytes > RECOVERED_FREE_BYTES && ratio > RECOVERED_FREE_RATIO;
  if ((previous === 'warn' || previous === 'critical') && !recovered) {
    if (volume.freeBytes < WARN_FREE_BYTES || ratio < WARN_FREE_RATIO) {
      return previous === 'critical' ? 'critical' : 'warn';
    }
    return previous;
  }
  if (volume.freeBytes < WARN_FREE_BYTES || ratio < WARN_FREE_RATIO) return 'warn';
  return 'ok';
}

export function configureDiskPressure(next: DiskPressureConfig): void {
  config = { ...config, ...next };
}

export function subscribeDiskPressure(listener: DiskPressureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDiskPressureSnapshot(): DiskPressureSnapshot {
  return snapshot;
}

export function isStorageWriteDegraded(): boolean {
  return snapshot.level === 'critical';
}

export function consumeRecoveredInjection(): boolean {
  if (!snapshot.recoveredPending) return false;
  snapshot = { ...snapshot, recoveredPending: false };
  return true;
}

export function resetDiskPressureForTests(): void {
  config = {};
  snapshot = {
    level: 'ok',
    pendingUserReclaim: false,
    recoveredPending: false,
    atMs: 0,
  };
  lastEmergencyGcMs = 0;
  lastReclaimQuestionMs = undefined;
  emergencyGcInFlight = undefined;
  listeners.clear();
}

export function shouldRequestReclaimQuestion(atMs: number = nowMs()): boolean {
  if (!snapshot.pendingUserReclaim) return false;
  if (lastReclaimQuestionMs === undefined) return true;
  return atMs - lastReclaimQuestionMs >= RECLAIM_QUESTION_COOLDOWN_MS;
}

export function markReclaimQuestionAsked(atMs: number = nowMs()): void {
  lastReclaimQuestionMs = atMs;
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Listener failures must not break the pressure path.
    }
  }
}

async function probePreferredVolume(): Promise<VolumeSpace | undefined> {
  const probe = config.probe ?? probeVolumeSpace;
  const homeDir = config.homeDir?.trim();
  if (homeDir !== undefined && homeDir.length > 0) {
    const home = await probe(homeDir);
    if (home !== undefined) return home;
  }
  const workDir = config.workDir?.trim();
  if (workDir !== undefined && workDir.length > 0) {
    const work = await probe(workDir);
    if (work !== undefined) return work;
  }
  return probe(process.cwd());
}

async function runEmergencyGc(volume: VolumeSpace | undefined): Promise<StorageGcReport | undefined> {
  const homeDir = config.homeDir?.trim();
  if (homeDir === undefined || homeDir.length === 0) return undefined;
  const at = nowMs();
  if (at - lastEmergencyGcMs < EMERGENCY_GC_THROTTLE_MS) {
    return snapshot.lastGc;
  }
  if (emergencyGcInFlight !== undefined) {
    await emergencyGcInFlight;
    return snapshot.lastGc;
  }
  const collect = config.collect ?? collectStorageGarbage;
  const run = (async () => {
    lastEmergencyGcMs = at;
    const report = await collect({
      homeDir,
      emergency: true,
      pruneLogs: true,
      availableFreeBytes: volume?.freeBytes,
      skipCompressBelowFreeBytes: GZIP_MIN_FREE_BYTES,
    });
    snapshot = { ...snapshot, lastGc: report, atMs: nowMs() };
  })();
  emergencyGcInFlight = run;
  try {
    await run;
  } catch {
    // Best-effort — GC must never crash the host.
  } finally {
    emergencyGcInFlight = undefined;
  }
  return snapshot.lastGc;
}

export async function reportDiskPressure(error?: unknown): Promise<DiskPressureSnapshot> {
  const kind = error === undefined ? snapshot.kind : classifyDiskFull(error);
  const writeFailed = error !== undefined && kind !== undefined;
  const previous = snapshot.level;
  let volume = await probePreferredVolume();
  const measure = config.measure ?? measureStorageBytes;
  const homeDir = config.homeDir?.trim();
  let home =
    homeDir !== undefined && homeDir.length > 0 ? await measure(homeDir).catch(() => undefined) : undefined;

  let level = classifyPressureLevel(volume, writeFailed, previous);
  let lastGc = snapshot.lastGc;
  if (level === 'critical') {
    lastGc = (await runEmergencyGc(volume)) ?? lastGc;
    volume = await probePreferredVolume();
    if (homeDir !== undefined && homeDir.length > 0) {
      home = await measure(homeDir).catch(() => home);
    }
    level = classifyPressureLevel(volume, writeFailed, 'critical');
  }

  const recoveredPending = previous !== 'ok' && level === 'ok';
  const pendingUserReclaim = level === 'critical';
  snapshot = {
    level,
    ...(kind !== undefined ? { kind } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(home !== undefined ? { home } : {}),
    ...(lastGc !== undefined ? { lastGc } : {}),
    pendingUserReclaim,
    recoveredPending: recoveredPending || (snapshot.recoveredPending && level === 'ok'),
    atMs: nowMs(),
  };
  notifyListeners();
  return snapshot;
}

export function formatHomeLine(home: StorageBytesReport | undefined): string {
  if (home === undefined) return 'home: (unknown)';
  return `home: sessions=${formatBytes(home.sessionsBytes)} cache=${formatBytes(home.cacheBytes)} logs=${formatBytes(home.logsBytes)}`;
}

export function formatVolumeLine(volume: VolumeSpace | undefined): string {
  if (volume === undefined) return 'volume: (unknown)';
  return `volume ${volume.path} free=${formatBytes(volume.freeBytes)} total=${formatBytes(volume.totalBytes)}`;
}

export function formatGcLine(report: StorageGcReport | undefined, stillCritical: boolean): string {
  if (report === undefined) {
    return stillCritical
      ? 'harness: emergency GC not yet applied. still critical.'
      : 'harness: no emergency GC this cycle.';
  }
  const freed = formatBytes(report.freedBytes);
  const suffix = stillCritical ? 'still critical.' : 'pressure eased.';
  return `harness: emergency GC freed ${freed} (cache/tmp/logs). ${suffix}`;
}

export function formatDiskFullToolOutput(current: DiskPressureSnapshot): string {
  const lines = [
    `DISK FULL (${ErrorCodes.STORAGE_DISK_FULL}): ${formatVolumeLine(current.volume)}`,
    formatHomeLine(current.home),
    formatGcLine(current.lastGc, current.level === 'critical'),
    'YOU MUST: stop large writes/downloads; prefer Edit; do not retry this write.',
    'YOU MUST NOT: delete workspace files without AskUserQuestion.',
  ];
  if (current.pendingUserReclaim) {
    lines.push(
      'USER DECISION PENDING: stop large I/O until the reclaim question is answered.',
    );
  }
  return lines.join('\n');
}

export async function diskFullToolError(error: unknown): Promise<string | undefined> {
  if (!isDiskFullError(error)) return undefined;
  const current = await reportDiskPressure(error);
  return formatDiskFullToolOutput(current);
}

export function renderDiskPressureInjection(current: DiskPressureSnapshot): string | undefined {
  if (current.level === 'ok') return undefined;
  const lines = [
    '<disk_pressure>',
    `level=${current.level}${current.kind !== undefined ? ` kind=${current.kind}` : ''}`,
    formatVolumeLine(current.volume),
    formatHomeLine(current.home),
    formatGcLine(current.lastGc, current.level === 'critical'),
    'YOU MUST: stop large writes/downloads; prefer Edit; do not retry the failed write.',
    'YOU MUST NOT: delete workspace files without AskUserQuestion.',
  ];
  if (current.pendingUserReclaim) {
    lines.push(
      'A reclaim question is pending (idle sessions / logs / recheck). Pause large I/O until the user answers.',
    );
  }
  lines.push('</disk_pressure>');
  return lines.join('\n');
}

export function renderDiskPressureRecoveredInjection(): string {
  return [
    '<disk_pressure>',
    'level=recovered',
    'Disk pressure cleared. Resume normal writes. Do not delete workspace files to "make space".',
    '</disk_pressure>',
  ].join('\n');
}

export function buildDiskPressureDegradedEvent(
  current: DiskPressureSnapshot,
  atMs: number = current.atMs,
): RuntimeDegradedEvent {
  const kind = current.kind ?? 'enospc';
  return {
    type: 'runtime.degraded',
    scope: 'storage',
    reason: current.pendingUserReclaim ? `disk_full_needs_reclaim:${kind}` : `disk_full:${kind}`,
    hint: DISK_PRESSURE_DEGRADED_HINT,
    atMs,
  };
}

export function buildDiskPressureReclaimQuestion(): QuestionItem {
  return {
    question: 'Disk is still full after emergency GC. How should SuperLiora free more home space?',
    header: 'Disk',
    body: 'Active sessions, credentials, memory, and workspace files are never deleted automatically.',
    options: [
      {
        label: DISK_RECLAIM_IDLE_SESSIONS,
        description: 'Delete session dirs idle for 7+ days (not the current session).',
      },
      {
        label: DISK_RECLAIM_TRUNCATE_LOGS,
        description: 'Delete remaining unlocked files under ~/.superliora/logs.',
      },
      {
        label: DISK_RECLAIM_RECHECK,
        description: 'Re-probe the volume after you freed space outside SuperLiora.',
      },
      {
        label: DISK_RECLAIM_WAIT,
        description: 'Keep waiting. SUPERLIORA_HOME can only move before relaunch.',
      },
    ],
  };
}

function selectedReclaimLabel(result: QuestionResult): string | undefined {
  if (result === null) return undefined;
  const answers =
    typeof result === 'object' && result !== null && 'answers' in result
      ? result.answers
      : result;
  if (answers === null || typeof answers !== 'object') return undefined;
  const first = Object.values(answers)[0];
  return typeof first === 'string' ? first : undefined;
}

export async function applyDiskPressureReclaimAnswer(
  result: QuestionResult,
): Promise<DiskPressureSnapshot> {
  const label = selectedReclaimLabel(result);
  const homeDir = config.homeDir?.trim();
  if (label === DISK_RECLAIM_IDLE_SESSIONS && homeDir !== undefined && homeDir.length > 0) {
    const reclaim = config.reclaimIdle ?? reclaimIdleSessions;
    try {
      const report = await reclaim({ homeDir, idleMs: IDLE_SESSION_RECLAIM_MS });
      snapshot = { ...snapshot, lastGc: report, atMs: nowMs() };
    } catch {
      // Best-effort.
    }
  } else if (label === DISK_RECLAIM_TRUNCATE_LOGS && homeDir !== undefined && homeDir.length > 0) {
    const collect = config.collect ?? collectStorageGarbage;
    try {
      const report = await collect({
        homeDir,
        emergency: true,
        pruneLogs: true,
        pruneCache: false,
        pruneWorktreeTmp: false,
        compressIdleWires: false,
      });
      snapshot = { ...snapshot, lastGc: report, atMs: nowMs() };
    } catch {
      // Best-effort.
    }
  }
  return reportDiskPressure();
}
