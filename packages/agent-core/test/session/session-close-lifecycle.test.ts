import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BACKGROUND_STOP_ON_EXIT_TIMEOUT_MS,
  SessionCloseLifecycle,
} from '../../src/session/lifecycle/session-close-lifecycle';

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionCloseLifecycle.stopBackgroundTasksOnExit', () => {
  it('settles when background stopAll never resolves', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const hungAgent = {
      background: {
        list: () => [{ taskId: 't1' }],
        suppressTerminalNotification: vi.fn(async () => {}),
        stopAll: vi.fn(() => new Promise<never>(() => {})),
      },
    };
    const lifecycle = new SessionCloseLifecycle({
      log: { warn, debug: vi.fn() } as never,
      agents: new Map([['main', Promise.resolve({ agent: hungAgent as never })]]),
      readyAgents: () => [],
      background: undefined,
    });

    const done = lifecycle.stopBackgroundTasksOnExit();
    await vi.advanceTimersByTimeAsync(BACKGROUND_STOP_ON_EXIT_TIMEOUT_MS + 1);
    await expect(done).resolves.toBeUndefined();
    expect(hungAgent.background.stopAll).toHaveBeenCalledWith('Session closed');
    expect(warn).toHaveBeenCalledWith(
      'timed out waiting for background tasks to stop during session close',
      expect.objectContaining({ timeoutMs: BACKGROUND_STOP_ON_EXIT_TIMEOUT_MS }),
    );
  });
});
