import { describe, expect, it } from 'vitest';

import { runSetupCommand } from '../src/setup-command';

describe('runSetupCommand', () => {
  it('resolves immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runSetupCommand(process.execPath, ['-e', 'process.exit(0)'], {
      signal: controller.signal,
      quiet: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Aborted');
  });

  it('aborts a long-running child and settles without hanging', async () => {
    const controller = new AbortController();
    const pending = runSetupCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { signal: controller.signal, quiet: true, timeoutMs: 60_000 },
    );
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.ok).toBe(false);
    // Close after SIGTERM/SIGKILL may omit `error` (non-zero code only).
    expect(result.error === undefined || /Aborted|Timed out/.test(result.error)).toBe(true);
  });
});
