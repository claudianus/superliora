import { describe, expect, it } from 'vitest';

import {
  formatInterruptedUserText,
  formatSteeredUserText,
  frameInterruptContent,
  frameSteerContent,
  INTERJECTION_NOTE,
  INTERRUPT_NOTE,
  LARGE_STEER_THRESHOLD,
  UNFINISHED_PREVIOUS_TURNS_REMINDER,
  UNFINISHED_TASKS_REMINDER,
} from '#/agent/turn/interjection';

describe('formatSteeredUserText', () => {
  it('wraps mid-turn text in a user_query envelope', () => {
    const out = formatSteeredUserText('stop and fix the test first');
    expect(out.startsWith(`${INTERJECTION_NOTE}\n<user_query>\n`)).toBe(true);
    expect(out).toContain('stop and fix the test first');
    expect(out.endsWith(`</user_query>\n${UNFINISHED_TASKS_REMINDER}`)).toBe(true);
  });

  it('truncates long steers on a code-point boundary', () => {
    const out = formatSteeredUserText('é'.repeat(LARGE_STEER_THRESHOLD + 8));
    expect(out).toContain('... [truncated]');
    expect(out.includes('é'.repeat(LARGE_STEER_THRESHOLD + 1))).toBe(false);
  });
});

describe('formatInterruptedUserText', () => {
  it('uses the interrupt note and previous-turn reminder', () => {
    const out = formatInterruptedUserText('do the other thing');
    expect(out).toBe(
      `${INTERRUPT_NOTE}\n<user_query>\ndo the other thing\n</user_query>\n${UNFINISHED_PREVIOUS_TURNS_REMINDER}`,
    );
  });
});

describe('frameSteerContent', () => {
  it('frames only the first text part for real user origins', () => {
    const framed = frameSteerContent(
      [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ],
      { kind: 'user' },
    );
    expect(framed[0]).toEqual({ type: 'text', text: formatSteeredUserText('one') });
    expect(framed[1]).toEqual({ type: 'text', text: 'two' });
  });

  it('leaves cron and injection origins unframed', () => {
    const input = [{ type: 'text', text: 'wake' }] as const;
    expect(frameSteerContent(input, { kind: 'cron_job' })).toEqual(input);
    expect(frameInterruptContent(input, { kind: 'injection', variant: 'system_reminder' })).toEqual(
      input,
    );
  });
});
