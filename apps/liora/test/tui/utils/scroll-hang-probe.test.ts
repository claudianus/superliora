import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SUPERLIORA_DEBUG_ENV, SUPERLIORA_HOME_ENV } from '#/constant/app';
import {
  formatScrollHangHudLine,
  lastScrollHangDumpForTest,
  recordScrollHangSample,
  resetScrollHangProbeForTest,
  SCROLL_HANG_CALLBACK_MS,
  setScrollHangProbeSinkForTest,
  setScrollHangTraceEnabledForTest,
} from '#/tui/utils/render/scroll-hang-probe';

describe('scroll hang probe', () => {
  const homes: string[] = [];
  const previousHome = process.env[SUPERLIORA_HOME_ENV];
  const previousDebug = process.env[SUPERLIORA_DEBUG_ENV];
  const previousTrace = process.env['SUPERLIORA_TUI_SCROLL_TRACE'];

  afterEach(() => {
    resetScrollHangProbeForTest();
    setScrollHangTraceEnabledForTest(undefined);
    setScrollHangProbeSinkForTest(undefined);
    if (previousHome === undefined) delete process.env[SUPERLIORA_HOME_ENV];
    else process.env[SUPERLIORA_HOME_ENV] = previousHome;
    if (previousDebug === undefined) delete process.env[SUPERLIORA_DEBUG_ENV];
    else process.env[SUPERLIORA_DEBUG_ENV] = previousDebug;
    if (previousTrace === undefined) delete process.env['SUPERLIORA_TUI_SCROLL_TRACE'];
    else process.env['SUPERLIORA_TUI_SCROLL_TRACE'] = previousTrace;
    for (const dir of homes.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formats a HUD line from the latest sample', () => {
    recordScrollHangSample({
      causes: ['transcript-scroll'],
      pureScroll: true,
      storm: true,
      childPaints: 0,
      materializeContinue: false,
      renderCbMs: 3.2,
      deferredQueueSize: 4,
      settleArmed: true,
      streamingPhase: 'idle',
      scrollHold: true,
    });
    expect(formatScrollHangHudLine()).toContain('scroll storm');
    expect(formatScrollHangHudLine()).toContain('childPaints=0');
    expect(formatScrollHangHudLine()).toContain('defer=4');
    expect(formatScrollHangHudLine()).toContain('hold=Y');
  });

  it('emits a dump when callback exceeds hang budget', () => {
    const dumps: unknown[] = [];
    setScrollHangProbeSinkForTest((dump) => {
      dumps.push(dump);
    });
    setScrollHangTraceEnabledForTest(false);
    delete process.env[SUPERLIORA_DEBUG_ENV];
    recordScrollHangSample({
      causes: ['transcript-scroll'],
      pureScroll: true,
      storm: false,
      childPaints: 2,
      materializeContinue: false,
      renderCbMs: SCROLL_HANG_CALLBACK_MS + 1,
      deferredQueueSize: 0,
      settleArmed: false,
      streamingPhase: 'idle',
      scrollHold: true,
    });
    expect(dumps).toHaveLength(1);
    expect(lastScrollHangDumpForTest()?.reason).toBe('callback-budget');
    expect(lastScrollHangDumpForTest()?.writtenPath).toBeUndefined();
  });

  it('writes hang dumps under the home log dir, never the workspace', () => {
    const home = mkdtempSync(join(tmpdir(), 'scroll-hang-home-'));
    const workDir = mkdtempSync(join(tmpdir(), 'scroll-hang-work-'));
    homes.push(home, workDir);
    process.env[SUPERLIORA_HOME_ENV] = home;
    delete process.env[SUPERLIORA_DEBUG_ENV];
    setScrollHangTraceEnabledForTest(true);
    recordScrollHangSample({
      causes: ['transcript-scroll'],
      pureScroll: true,
      storm: false,
      childPaints: 2,
      materializeContinue: false,
      renderCbMs: SCROLL_HANG_CALLBACK_MS + 1,
      deferredQueueSize: 0,
      settleArmed: false,
      streamingPhase: 'idle',
      scrollHold: true,
    });
    const writtenPath = lastScrollHangDumpForTest()?.writtenPath;
    expect(writtenPath).toBeDefined();
    expect(writtenPath?.replaceAll('\\', '/')).toContain(`${home.replaceAll('\\', '/')}/logs/scroll-hang-`);
    expect(existsSync(writtenPath!)).toBe(true);
    expect(readdirSync(workDir)).toEqual([]);
  });
});
