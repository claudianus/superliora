import { PassThrough, Readable } from 'node:stream';

import type { KaosProcess } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { DeferredProcessBackgroundTask } from '../../../src/agent/background/deferred-process-task';
import type { BackgroundTaskSettlement } from '../../../src/agent/background/task';

function sigtermIgnoringProcess(): KaosProcess & { kill: ReturnType<typeof vi.fn> } {
  const exited = Promise.withResolvers<number>();
  const stdin = new PassThrough();
  const stdout = Readable.from([]);
  const stderr = Readable.from([]);
  return {
    stdin, stdout, stderr, pid: 321, exitCode: null,
    wait: () => exited.promise,
    kill: vi.fn(async (signal?: string) => { if (signal === 'SIGKILL') exited.resolve(137); }),
    dispose: vi.fn(async () => { stdin.destroy(); stdout.destroy(); stderr.destroy(); }),
  };
}

describe('DeferredProcessBackgroundTask', () => {
  it('applies a force stop requested during spawn once the process is adopted', async () => {
    const proc = sigtermIgnoringProcess();
    const spawned = Promise.withResolvers<KaosProcess>();
    const prepareEntered = Promise.withResolvers<void>();
    const task = new DeferredProcessBackgroundTask('sleep 999', 'ignores SIGTERM', '/workspace', () => {
      prepareEntered.resolve();
      return spawned.promise;
    });
    const abort = new AbortController();
    const settlements: BackgroundTaskSettlement[] = [];
    const started = task.start({
      signal: abort.signal,
      appendOutput: () => {},
      settle: async (settlement) => { settlements.push(settlement); return true; },
    });
    await prepareEntered.promise;
    abort.abort('stop');
    // The manager's escalation arrives while the spawn is still pending.
    await task.forceStop();
    expect(proc.kill).not.toHaveBeenCalled();
    spawned.resolve(proc);
    await started;
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settlements).toEqual([{ status: 'killed' }]);
    expect(task.resourcesSettled).toBe(true);
  });
});
