import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { setStartupTraceMaxBytesForTest, startupTrace } from '#/utils/startup-trace';

describe('startup-trace', () => {
  const homes: string[] = [];
  const previousTrace = process.env['SUPERLIORA_TUI_STARTUP_TRACE'];

  afterEach(() => {
    if (previousTrace === undefined) delete process.env['SUPERLIORA_TUI_STARTUP_TRACE'];
    else process.env['SUPERLIORA_TUI_STARTUP_TRACE'] = previousTrace;
    setStartupTraceMaxBytesForTest(undefined);
    for (const dir of homes.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resets the trace file when it would grow past the byte cap', () => {
    const home = mkdtempSync(join(tmpdir(), 'startup-trace-'));
    homes.push(home);
    const tracePath = join(home, 'startup-trace.log');
    process.env['SUPERLIORA_TUI_STARTUP_TRACE'] = tracePath;
    startupTrace('first');
    setStartupTraceMaxBytesForTest(24);
    startupTrace('second-step-that-is-long-enough-to-rotate');
    const body = readFileSync(tracePath, 'utf8');
    expect(body).toContain('second-step-that-is-long-enough-to-rotate');
    expect(body).not.toContain('first');
  });
});
