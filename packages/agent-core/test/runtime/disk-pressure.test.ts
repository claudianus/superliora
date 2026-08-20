import { describe, expect, it, afterEach } from 'vitest';

import { ErrorCodes } from '../../src/errors/codes';
import {
  applyDiskPressureReclaimAnswer,
  buildDiskPressureDegradedEvent,
  classifyDiskFull,
  classifyPressureLevel,
  configureDiskPressure,
  DISK_PRESSURE_DEGRADED_HINT,
  DISK_RECLAIM_RECHECK,
  formatDiskFullToolOutput,
  isDatabaseFullError,
  isDiskFullError,
  renderDiskPressureInjection,
  renderDiskPressureRecoveredInjection,
  markReclaimQuestionAsked,
  reportDiskPressure,
  resetDiskPressureForTests,
  shouldRequestReclaimQuestion,
  WIN32_ERROR_DISK_FULL,
  WARN_FREE_BYTES,
  CRITICAL_FREE_BYTES,
  RECOVERED_FREE_BYTES,
  type VolumeSpace,
} from '../../src/runtime/disk-pressure';
import { isDatabaseCorruptionError } from '../../src/memory/store-persistence-sqlite';

afterEach(() => {
  resetDiskPressureForTests();
});

function volume(freeBytes: number, totalBytes = 10 * 1024 * 1024 * 1024): VolumeSpace {
  return { path: 'C:', freeBytes, totalBytes };
}

describe('classifyDiskFull', () => {
  it('classifies ENOSPC, EDQUOT, SQLITE_FULL, and Win32 112', () => {
    expect(classifyDiskFull(Object.assign(new Error('write'), { code: 'ENOSPC' }))).toBe('enospc');
    expect(classifyDiskFull(Object.assign(new Error('quota'), { code: 'EDQUOT' }))).toBe('edquot');
    expect(classifyDiskFull(new Error('SQLITE_FULL: database or disk is full'))).toBe('sqlite_full');
    expect(
      classifyDiskFull(Object.assign(new Error('win'), { errno: WIN32_ERROR_DISK_FULL })),
    ).toBe('win32_disk_full');
    expect(classifyDiskFull(new Error('There is not enough space on the disk'))).toBe(
      'win32_disk_full',
    );
  });

  it('does not treat SQLITE_CORRUPT as disk full', () => {
    const corrupt = new Error('SQLITE_CORRUPT: database disk image is malformed');
    expect(isDiskFullError(corrupt)).toBe(false);
    expect(isDatabaseFullError(corrupt)).toBe(false);
    expect(isDatabaseCorruptionError(corrupt)).toBe(true);
  });

  it('does not treat SQLITE_FULL as corruption', () => {
    const full = new Error('SQLITE_FULL: database or disk is full');
    expect(isDatabaseFullError(full)).toBe(true);
    expect(isDatabaseCorruptionError(full)).toBe(false);
  });
});

describe('classifyPressureLevel', () => {
  it('treats write failure and tiny free space as critical', () => {
    expect(classifyPressureLevel(volume(CRITICAL_FREE_BYTES - 1), false, 'ok')).toBe('critical');
    expect(classifyPressureLevel(volume(WARN_FREE_BYTES * 2), true, 'ok')).toBe('critical');
  });

  it('stays critical until recovered hysteresis', () => {
    const mid = volume(WARN_FREE_BYTES + 1024);
    expect(classifyPressureLevel(mid, false, 'critical')).toBe('critical');
    expect(
      classifyPressureLevel(volume(RECOVERED_FREE_BYTES + 1), false, 'critical'),
    ).toBe('ok');
  });
});

describe('disk pressure render', () => {
  it('formats a critical tool error and injection', async () => {
    configureDiskPressure({
      homeDir: '/tmp/home',
      probe: async () => volume(0),
      measure: async () => ({
        homeDir: '/tmp/home',
        homeBytes: 10,
        sessionsBytes: 4,
        cacheBytes: 3,
        logsBytes: 2,
      }),
      collect: async () => ({
        homeDir: '/tmp/home',
        dryRun: false,
        items: [],
        freedBytes: 12,
        compressed: 0,
        deleted: 1,
        skipped: 0,
      }),
    });
    const snap = await reportDiskPressure(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    expect(snap.level).toBe('critical');
    expect(snap.pendingUserReclaim).toBe(true);
    const tool = formatDiskFullToolOutput(snap);
    expect(tool).toContain(ErrorCodes.STORAGE_DISK_FULL);
    expect(tool).toContain('YOU MUST');
    expect(tool).toContain('YOU MUST NOT');
    expect(tool).toContain('do not retry');
    const injection = renderDiskPressureInjection(snap);
    expect(injection).toContain('<disk_pressure>');
    expect(injection).toContain('level=critical');
    expect(injection).toContain('kind=enospc');
    expect(renderDiskPressureInjection({ ...snap, level: 'ok' })).toBeUndefined();
    expect(renderDiskPressureRecoveredInjection()).toContain('level=recovered');
  });

  it('builds a storage runtime.degraded event', async () => {
    configureDiskPressure({
      homeDir: '/tmp/home',
      probe: async () => volume(0),
      measure: async () => ({
        homeDir: '/tmp/home',
        homeBytes: 1,
        sessionsBytes: 1,
        cacheBytes: 0,
        logsBytes: 0,
      }),
      collect: async () => ({
        homeDir: '/tmp/home',
        dryRun: false,
        items: [],
        freedBytes: 0,
        compressed: 0,
        deleted: 0,
        skipped: 0,
      }),
    });
    const snap = await reportDiskPressure(new Error('SQLITE_FULL: database or disk is full'));
    expect(buildDiskPressureDegradedEvent(snap, 99)).toEqual({
      type: 'runtime.degraded',
      scope: 'storage',
      reason: 'disk_full_needs_reclaim:sqlite_full',
      hint: DISK_PRESSURE_DEGRADED_HINT,
      atMs: 99,
    });
  });

  it('recheck reclaim answer re-probes without deleting', async () => {
    let probes = 0;
    configureDiskPressure({
      homeDir: '/tmp/home',
      probe: async () => {
        probes += 1;
        return volume(RECOVERED_FREE_BYTES + 10);
      },
      measure: async () => ({
        homeDir: '/tmp/home',
        homeBytes: 1,
        sessionsBytes: 0,
        cacheBytes: 0,
        logsBytes: 0,
      }),
    });
    const snap = await applyDiskPressureReclaimAnswer({
      answers: { q: DISK_RECLAIM_RECHECK },
    });
    expect(probes).toBeGreaterThan(0);
    expect(snap.level).toBe('ok');
    expect(snap.pendingUserReclaim).toBe(false);
  });

  it('cools down reclaim questions so WAIT does not loop', async () => {
    configureDiskPressure({
      homeDir: '/tmp/home',
      now: () => 1_000,
      probe: async () => volume(0),
      measure: async () => ({
        homeDir: '/tmp/home',
        homeBytes: 1,
        sessionsBytes: 0,
        cacheBytes: 0,
        logsBytes: 0,
      }),
      collect: async () => ({
        homeDir: '/tmp/home',
        dryRun: false,
        items: [],
        freedBytes: 0,
        compressed: 0,
        deleted: 0,
        skipped: 0,
      }),
    });
    await reportDiskPressure(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    expect(shouldRequestReclaimQuestion(1_000)).toBe(true);
    markReclaimQuestionAsked(1_000);
    expect(shouldRequestReclaimQuestion(1_000)).toBe(false);
    expect(shouldRequestReclaimQuestion(1_000 + 60_000)).toBe(true);
  });
});
