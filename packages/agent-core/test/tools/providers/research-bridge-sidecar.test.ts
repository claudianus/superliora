/**
 * Covers: Ch5 research-bridge auto-serve sidecar (loopback probe → --serve spawn).
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHROME_RESEARCH_BRIDGE_ENV,
  CHROME_EXT_BRIDGE_ENV,
} from '../../../src/tools/providers/research-bridge-status';
import {
  disposeResearchBridgeSidecar,
  ensureResearchBridgeSidecar,
  getResearchBridgeSidecarPid,
  isResearchBridgeSidecarRunning,
  resetResearchBridgeSidecarState,
} from '../../../src/tools/providers/research-bridge-sidecar';

const SCRIPT = '/tmp/research-bridge-native-host.mjs';

function mockChild(pid = 42): ChildProcess {
  const stdout = new EventEmitter();
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid, killed: false, stdout, kill: vi.fn(() => { child.killed = true; }) });
  return child;
}

describe('research-bridge-sidecar', () => {
  afterEach(() => {
    resetResearchBridgeSidecarState();
  });

  it('no-ops when env gate is off', async () => {
    const spawn = vi.fn();
    const ok = await ensureResearchBridgeSidecar({
      env: {} as NodeJS.ProcessEnv,
      spawn,
      resolveAgentCoreRoot: () => '/agent-core',
    });
    expect(ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('skips spawn when loopback probe succeeds', async () => {
    const spawn = vi.fn();
    const env = { [CHROME_RESEARCH_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    const ok = await ensureResearchBridgeSidecar({
      env,
      spawn,
      resolveAgentCoreRoot: () => '/agent-core',
      probeLoopback: () => ({ ok: true, probedAt: 1 }),
    });
    expect(ok).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('accepts legacy env alias', async () => {
    const spawn = vi.fn();
    const env = { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    const ok = await ensureResearchBridgeSidecar({
      env,
      spawn,
      resolveAgentCoreRoot: () => '/agent-core',
      probeLoopback: () => ({ ok: true, probedAt: 1 }),
    });
    expect(ok).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns --serve once when loopback probe fails', async () => {
    const child = mockChild(9001);
    let spawnCalls = 0;
    const spawn = vi.fn(() => {
      spawnCalls += 1;
      queueMicrotask(() => {
        child.stdout?.emit('data', Buffer.from('research-bridge serve ok (127.0.0.1:32123/search)\n'));
      });
      return child;
    });

    const env = { [CHROME_RESEARCH_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    const ok = await ensureResearchBridgeSidecar({
      env,
      spawn,
      resolveAgentCoreRoot: () => '/agent-core',
      resolveScriptPath: () => SCRIPT,
      probeLoopback: () => ({ ok: false, error: 'down', probedAt: 1 }),
      startupMs: 500,
    });

    expect(ok).toBe(true);
    expect(spawnCalls).toBe(1);
    expect(spawn).toHaveBeenCalledWith(process.execPath, [SCRIPT, '--serve'], expect.any(Object));
    expect(getResearchBridgeSidecarPid()).toBe(9001);
    expect(isResearchBridgeSidecarRunning()).toBe(true);
  });

  it('does not double-spawn on concurrent ensure calls', async () => {
    const child = mockChild(9002);
    let spawnCalls = 0;
    const spawn = vi.fn(() => {
      spawnCalls += 1;
      setTimeout(() => {
        child.stdout?.emit('data', Buffer.from('research-bridge serve ok\n'));
      }, 20);
      return child;
    });

    const env = { [CHROME_RESEARCH_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    const deps = {
      env,
      spawn,
      resolveAgentCoreRoot: () => '/agent-core',
      resolveScriptPath: () => SCRIPT,
      probeLoopback: () => ({ ok: false, probedAt: 1 }),
      startupMs: 500,
    };

    const [a, b] = await Promise.all([
      ensureResearchBridgeSidecar(deps),
      ensureResearchBridgeSidecar(deps),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(spawnCalls).toBe(1);
  });

  it('dispose kills tracked child', async () => {
    const child = mockChild(9003);
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout?.emit('data', Buffer.from('research-bridge serve ok\n'));
      });
      return child;
    });

    const env = { [CHROME_RESEARCH_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    await ensureResearchBridgeSidecar({
      env,
      spawn,
      resolveAgentCoreRoot: () => '/agent-core',
      resolveScriptPath: () => SCRIPT,
      probeLoopback: () => ({ ok: false, probedAt: 1 }),
      startupMs: 500,
    });

    disposeResearchBridgeSidecar();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(isResearchBridgeSidecarRunning()).toBe(false);
    expect(getResearchBridgeSidecarPid()).toBeUndefined();
  });
});
