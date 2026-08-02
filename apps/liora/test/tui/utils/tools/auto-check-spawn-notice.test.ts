import { describe, expect, it } from 'vitest';

import {
  AUTO_CHECK_SPAWN_PREFIX,
  extractAutoCheckSpawnPackageDir,
  formatAutoCheckSpawnNotice,
  isAutoCheckSpawnFailedOutput,
  isAutoCheckSpawnOutput,
} from '../../../../src/tui/utils/tools/auto-check-spawn-notice';

const okBlock =
  'AUTO_CHECK_SPAWN: RunProjectChecks OK (packageDir=packages/agent-core, checks=["test","typecheck"])\n✓ 12 passed';
const failBlock =
  'AUTO_CHECK_SPAWN: RunProjectChecks FAILED (packageDir=apps/liora, checks=["test"])\n2 failed';

describe('isAutoCheckSpawnOutput (Loop33a)', () => {
  it('detects the stable prefix', () => {
    expect(isAutoCheckSpawnOutput(okBlock)).toBe(true);
    expect(isAutoCheckSpawnOutput(failBlock)).toBe(true);
    expect(isAutoCheckSpawnOutput('PostToolUse sensor: source mutated')).toBe(false);
  });

  it('detects FAILED vs OK', () => {
    expect(isAutoCheckSpawnFailedOutput(failBlock)).toBe(true);
    expect(isAutoCheckSpawnFailedOutput(okBlock)).toBe(false);
  });
});

describe('extractAutoCheckSpawnPackageDir', () => {
  it('reads packageDir from the spawn header', () => {
    expect(extractAutoCheckSpawnPackageDir(okBlock)).toBe('packages/agent-core');
    expect(extractAutoCheckSpawnPackageDir(failBlock)).toBe('apps/liora');
  });
});

describe('formatAutoCheckSpawnNotice', () => {
  it('names OK recovery path', () => {
    const notice = formatAutoCheckSpawnNotice('Edit', okBlock);
    expect(notice.title).toBe('Auto-check passed');
    expect(notice.detail).toContain('Edit');
    expect(notice.detail).toContain('packages/agent-core');
    expect(notice.status).toContain('OK');
    expect(notice.failed).toBe(false);
    expect(notice.coalesceKey).toBe('auto-check-spawn');
  });

  it('names FAILED path with warning status text', () => {
    const notice = formatAutoCheckSpawnNotice('Write', failBlock);
    expect(notice.title).toBe('Auto-check failed');
    expect(notice.failed).toBe(true);
    expect(notice.status).toMatch(/FAILED/);
    expect(notice.detail).toContain(AUTO_CHECK_SPAWN_PREFIX);
  });
});
