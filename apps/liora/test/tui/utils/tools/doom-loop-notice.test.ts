import { describe, expect, it } from 'vitest';

import {
  DOOM_LOOP_HARD_STOP_CODE,
  DOOM_LOOP_WARN_PREFIX,
  formatDoomLoopHardStopNotice,
  formatDoomLoopSoftWarnNotice,
  isDoomLoopHardStopOutput,
  isDoomLoopSoftWarnOutput,
} from '../../../../src/tui/utils/tools/doom-loop-notice';

describe('isDoomLoopHardStopOutput', () => {
  it('detects the engine hard-stop marker in plain text', () => {
    expect(
      isDoomLoopHardStopOutput(
        `doom_loop_hard_stop: blocked. code=${DOOM_LOOP_HARD_STOP_CODE}. try another approach.`,
      ),
    ).toBe(true);
  });

  it('detects the marker nested in JSON-like objects', () => {
    expect(
      isDoomLoopHardStopOutput({
        error: DOOM_LOOP_HARD_STOP_CODE,
        message: 'identical call blocked',
      }),
    ).toBe(true);
  });

  it('ignores ordinary tool failures', () => {
    expect(isDoomLoopHardStopOutput('ENOENT: file not found')).toBe(false);
    expect(isDoomLoopHardStopOutput({ error: 'timeout' })).toBe(false);
    expect(isDoomLoopHardStopOutput(null)).toBe(false);
  });
});

describe('isDoomLoopSoftWarnOutput', () => {
  it('detects the soft warn tip prefix', () => {
    expect(
      isDoomLoopSoftWarnOutput(
        `ok\n\n${DOOM_LOOP_WARN_PREFIX} identical Bash call repeated 4 times this turn`,
      ),
    ).toBe(true);
  });

  it('does not treat hard stop as soft warn', () => {
    expect(
      isDoomLoopSoftWarnOutput(
        `doom_loop_hard_stop: blocked. code=${DOOM_LOOP_HARD_STOP_CODE}`,
      ),
    ).toBe(false);
  });
});

describe('formatDoomLoopHardStopNotice', () => {
  it('names the tool and recovery path', () => {
    const notice = formatDoomLoopHardStopNotice('Bash');
    expect(notice.title).toBe('Doom loop hard stop');
    expect(notice.detail).toContain('Bash');
    expect(notice.detail).toContain(DOOM_LOOP_HARD_STOP_CODE);
    expect(notice.status).toMatch(/doom loop hard stop on Bash/);
    expect(notice.coalesceKey).toBe('doom-loop-hard-stop');
  });

  it('falls back when tool name is missing', () => {
    const notice = formatDoomLoopHardStopNotice();
    expect(notice.status).toMatch(/on tool$/);
  });
});

describe('formatDoomLoopSoftWarnNotice', () => {
  it('names the tool and soft-warn path', () => {
    const notice = formatDoomLoopSoftWarnNotice('Read');
    expect(notice.title).toBe('Doom loop soft warn');
    expect(notice.detail).toContain('Read');
    expect(notice.detail).toContain(DOOM_LOOP_WARN_PREFIX);
    expect(notice.coalesceKey).toBe('doom-loop-soft-warn');
  });
});
