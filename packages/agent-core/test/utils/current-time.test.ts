import { describe, expect, it } from 'vitest';

import {
  buildCurrentTimeReminder,
  formatCurrentTimeSnapshot,
} from '../../src/utils/current-time';
import { GetCurrentTimeTool } from '../../src/tools/builtin';
import { executeTool } from '../tools/fixtures/execute-tool';

const signal = new AbortController().signal;

describe('formatCurrentTimeSnapshot', () => {
  it('formats a fixed instant with local timezone fields', () => {
    const snapshot = formatCurrentTimeSnapshot(new Date('2026-07-07T05:51:00.000Z'));

    expect(snapshot.iso).toMatch(/^2026-07-07T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(snapshot.today).toContain('2026');
    expect(snapshot.today).toContain('July');
    expect(snapshot.local).toContain('2026');
    expect(snapshot.timezone.length).toBeGreaterThan(0);
    expect(snapshot.utcOffset).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
  });
});

describe('buildCurrentTimeReminder', () => {
  it('includes authoritative clock guidance and search year reminder', () => {
    const snapshot = {
      iso: '2026-07-07T14:51:00.000+09:00',
      today: 'Tuesday, July 7, 2026',
      local: 'Tuesday, July 7, 2026, 2:51 PM',
      timezone: 'Asia/Seoul',
      utcOffset: 'UTC+09:00',
    };

    const reminder = buildCurrentTimeReminder(snapshot);

    expect(reminder).toContain('<current_time>');
    expect(reminder).toContain('Tuesday, July 7, 2026');
    expect(reminder).toContain('Asia/Seoul');
    expect(reminder).toContain('GetCurrentTime');
    expect(reminder).toContain('WebSearch/FetchURL');
  });
});

describe('GetCurrentTimeTool', () => {
  it('returns the current clock snapshot as JSON', async () => {
    const tool = new GetCurrentTimeTool();
    const result = await executeTool(tool, { turnId: '0', toolCallId: 'call_1', args: {}, signal });

    expect(result.isError).toBeFalsy();
    const snapshot = JSON.parse(result.output ?? '{}') as {
      iso: string;
      today: string;
      local: string;
      timezone: string;
      utcOffset: string;
    };
    expect(snapshot.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.today.length).toBeGreaterThan(0);
    expect(snapshot.local.length).toBeGreaterThan(0);
    expect(snapshot.timezone.length).toBeGreaterThan(0);
    expect(snapshot.utcOffset).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
  });
});
