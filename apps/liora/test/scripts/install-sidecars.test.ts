import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SIDECAR_STEP_TIMEOUT_MS,
  installSidecars,
} from '../../../../scripts/install/sidecars.mjs';
import { spawnTimedOut } from '../../../../scripts/install/spawn.mjs';

const tempDirs: string[] = [];

async function makeSourceTree(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-sidecar-'));
  tempDirs.push(dir);
  await writeFile(join(dir, 'package.json'), '{"name":"superliora"}\n', 'utf8');
  await mkdir(join(dir, 'packages', 'agent-core'), { recursive: true });
  return dir;
}

function timedOutResult() {
  return {
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('spawnSync timed out'), { code: 'ETIMEDOUT' }),
  };
}

describe('scripts/install/sidecars', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('caps each sidecar spawn and closes stdin so a prompt cannot stall upgrade', async () => {
    const installDir = await makeSourceTree();
    const pnpmCalls: Array<{ args: readonly string[]; timeout?: number; stdio?: unknown }> = [];
    const spawnCalls: Array<{ timeout?: number; stdio?: unknown }> = [];
    const downloads: Array<{ timeoutMs?: number }> = [];

    await installSidecars({
      installDir,
      platform: 'linux',
      arch: 'x64',
      env: {},
      ensurePnpm: async () => ({ cmd: 'pnpm', bootstrapped: false }),
      downloadToFile: async (_url: string, _dest: string, options: { timeoutMs?: number } = {}) => {
        downloads.push({ timeoutMs: options.timeoutMs });
      },
      runPnpm: (args: readonly string[], options: { timeout?: number; stdio?: unknown } = {}) => {
        pnpmCalls.push({ args, timeout: options.timeout, stdio: options.stdio });
        return { status: 0 };
      },
      spawnInstall: (_cmd?: string, _args?: readonly string[], options: { timeout?: number; stdio?: unknown } = {}) => {
        spawnCalls.push({ timeout: options.timeout, stdio: options.stdio });
        return { status: 0 };
      },
    });

    expect(downloads.some((call) => call.timeoutMs === SIDECAR_STEP_TIMEOUT_MS)).toBe(true);
    expect(pnpmCalls.length).toBeGreaterThanOrEqual(3);
    expect(pnpmCalls.every((call) => call.timeout === SIDECAR_STEP_TIMEOUT_MS)).toBe(true);
    expect(pnpmCalls.every((call) => Array.isArray(call.stdio) && call.stdio[0] === 'ignore')).toBe(true);
    expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
    expect(spawnCalls.every((call) => call.timeout === SIDECAR_STEP_TIMEOUT_MS)).toBe(true);
    expect(spawnCalls.every((call) => Array.isArray(call.stdio) && call.stdio[0] === 'ignore')).toBe(true);
    expect(pnpmCalls.some((call) => call.args.includes('cloakbrowser'))).toBe(true);
    expect(pnpmCalls.some((call) => call.args.includes('camoufox'))).toBe(true);
    expect(pnpmCalls.some((call) => call.args.includes('retrieval:bootstrap'))).toBe(true);
  });

  it('soft-fails a timed-out step and continues later sidecars', async () => {
    const installDir = await makeSourceTree();
    const warnings: string[] = [];
    const pnpmArgs: string[][] = [];

    await installSidecars({
      installDir,
      platform: 'win32',
      arch: 'x64',
      env: {},
      ensurePnpm: async () => ({ cmd: 'pnpm', bootstrapped: false }),
      downloadToFile: async () => {
        throw new Error('should not download Lightpanda on Windows');
      },
      runPnpm: (args: readonly string[]) => {
        pnpmArgs.push([...args]);
        if (args.includes('camoufox')) return timedOutResult();
        return { status: 0 };
      },
      spawnInstall: () => ({ status: 0 }),
      onWarn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(warnings.some((line) => line.includes('timed out') && line.includes('Camoufox'))).toBe(true);
    expect(pnpmArgs.some((args) => args.includes('retrieval:bootstrap'))).toBe(true);
  });

  it('does not download sidecars when Upgrade Studio closed stdin', async () => {
    const installDir = await makeSourceTree();
    let pnpmCalls = 0;
    let spawnCalls = 0;
    const warnings: string[] = [];

    await installSidecars({
      installDir,
      platform: 'win32',
      env: { SUPERLIORA_OBSERVED_UPGRADE: '1' },
      ensurePnpm: async () => {
        throw new Error('observed upgrade must not bootstrap pnpm for sidecars');
      },
      runPnpm: () => {
        pnpmCalls += 1;
        return { status: 0 };
      },
      spawnInstall: () => {
        spawnCalls += 1;
        return { status: 0 };
      },
      onWarn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(pnpmCalls).toBe(0);
    expect(spawnCalls).toBe(0);
    expect(warnings.some((line) => line.includes('observed upgrade'))).toBe(true);
  });

  it('skips remaining optional installs when the sidecar budget is already gone', async () => {
    const installDir = await makeSourceTree();
    let pnpmCalls = 0;
    let spawnCalls = 0;
    const warnings: string[] = [];

    await installSidecars({
      installDir,
      platform: 'linux',
      budgetMs: 0,
      env: {},
      ensurePnpm: async () => ({ cmd: 'pnpm', bootstrapped: false }),
      runPnpm: () => {
        pnpmCalls += 1;
        return { status: 0 };
      },
      spawnInstall: () => {
        spawnCalls += 1;
        return { status: 0 };
      },
      onWarn: (message: string) => {
        warnings.push(message);
      },
    });

    expect(pnpmCalls).toBe(0);
    expect(spawnCalls).toBe(0);
    expect(warnings.some((line) => line.includes('budget exhausted'))).toBe(true);
  });
});

describe('spawnTimedOut', () => {
  it('detects Node spawnSync timeout results', () => {
    expect(spawnTimedOut(timedOutResult())).toBe(true);
    expect(spawnTimedOut({ status: 1, error: new Error('fail') })).toBe(false);
    expect(spawnTimedOut({ status: 0 })).toBe(false);
  });
});
