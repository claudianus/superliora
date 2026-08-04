import { describe, expect, it } from 'vitest';

import {
  DOOMED_RUN_HARD_STOP_STREAK,
  DOOMED_RUN_WARN_ORIGIN,
  DOOMED_RUN_WARN_STREAK,
  formatDoomedRunWarnTip,
  hasDoomedRunWarnReminder,
  trailingToolErrorStreak,
} from '#/agent/turn/doomed-run-guard';
import type { ContextMessage } from '#/agent/context';

function toolMessage(isError: boolean): ContextMessage {
  return {
    role: 'tool',
    toolCallId: `call-${String(Math.random())}`,
    content: [{ type: 'text', text: isError ? 'boom' : 'ok' }],
    isError,
  } as ContextMessage;
}

function assistantMessage(): ContextMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'thinking out loud' }],
    toolCalls: [],
  } as ContextMessage;
}

describe('doomed-run guard', () => {
  it('counts only the trailing error streak', () => {
    const history = [
      toolMessage(true),
      toolMessage(false),
      assistantMessage(),
      toolMessage(true),
      toolMessage(true),
      toolMessage(true),
    ];
    expect(trailingToolErrorStreak(history)).toBe(3);
  });

  it('skips non-tool messages inside the streak window', () => {
    const history = [
      toolMessage(false),
      toolMessage(true),
      assistantMessage(),
      toolMessage(true),
    ];
    expect(trailingToolErrorStreak(history)).toBe(2);
  });

  it('returns zero when the newest tool result succeeded', () => {
    const history = [toolMessage(true), toolMessage(true), toolMessage(false)];
    expect(trailingToolErrorStreak(history)).toBe(0);
  });

  it('caps the backward scan so long sessions stay cheap', () => {
    const history: ContextMessage[] = [];
    for (let i = 0; i < 500; i += 1) history.push(toolMessage(true));
    expect(trailingToolErrorStreak(history)).toBeLessThanOrEqual(80);
  });

  it('thresholds keep warn before hard stop', () => {
    expect(DOOMED_RUN_WARN_STREAK).toBeLessThan(DOOMED_RUN_HARD_STOP_STREAK);
    expect(DOOMED_RUN_WARN_STREAK).toBeGreaterThanOrEqual(3);
  });

  it('detects the one-shot warn reminder by origin variant', () => {
    const reminder = {
      role: 'user',
      content: [{ type: 'text', text: formatDoomedRunWarnTip(DOOMED_RUN_WARN_STREAK) }],
      origin: { kind: 'injection', variant: DOOMED_RUN_WARN_ORIGIN },
    } as ContextMessage;
    expect(hasDoomedRunWarnReminder([toolMessage(true)])).toBe(false);
    expect(hasDoomedRunWarnReminder([reminder])).toBe(true);
  });

  it('warn tip names the streak and the hard-stop threshold', () => {
    const tip = formatDoomedRunWarnTip(DOOMED_RUN_WARN_STREAK);
    expect(tip).toContain(String(DOOMED_RUN_WARN_STREAK));
    expect(tip).toContain(String(DOOMED_RUN_HARD_STOP_STREAK));
  });
});
