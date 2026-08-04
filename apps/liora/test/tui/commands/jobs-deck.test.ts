/**
 * Job Deck entry points — `/jobs deck` routing and the worker transcript
 * formatter that powers the drill-down view.
 */

import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { handleJobCommand, handleJobsCommand } from '#/tui/commands/jobs';
import { formatJobDeckTraceLines } from '#/tui/commands/jobs-deck';

function createHost() {
  return {
    showStatus: vi.fn(),
    sendNormalUserInput: vi.fn(),
    jobBoardController: {
      toggle: vi.fn(),
      openDeck: vi.fn(),
      rememberUsage: vi.fn(),
    },
  } as unknown as SlashCommandHost & {
    showStatus: ReturnType<typeof vi.fn>;
    sendNormalUserInput: ReturnType<typeof vi.fn>;
    jobBoardController: {
      toggle: ReturnType<typeof vi.fn>;
      openDeck: ReturnType<typeof vi.fn>;
      rememberUsage: ReturnType<typeof vi.fn>;
    };
  };
}

describe('/jobs deck routing', () => {
  it('opens the deck without a job id', () => {
    const host = createHost();
    handleJobsCommand(host, 'deck');
    expect(host.jobBoardController.openDeck).toHaveBeenCalledTimes(1);
    expect(host.jobBoardController.openDeck.mock.calls[0]?.[0]).toBeUndefined();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('accepts monitor/watch aliases', () => {
    const host = createHost();
    handleJobsCommand(host, 'monitor');
    handleJobsCommand(host, 'watch');
    expect(host.jobBoardController.openDeck).toHaveBeenCalledTimes(2);
  });

  it('drills into a specific job id', () => {
    const host = createHost();
    handleJobsCommand(host, 'deck job_a1b2c3d4');
    expect(host.jobBoardController.openDeck).toHaveBeenCalledWith('job_a1b2c3d4');
  });

  it('keeps /jobs board on the panel toggle', () => {
    const host = createHost();
    handleJobsCommand(host, 'board');
    expect(host.jobBoardController.toggle).toHaveBeenCalledTimes(1);
    expect(host.jobBoardController.openDeck).not.toHaveBeenCalled();
  });

  it('/job deck <id> also opens the deck', () => {
    const host = createHost();
    handleJobCommand(host, 'deck job_0000ffff');
    expect(host.jobBoardController.openDeck).toHaveBeenCalledWith('job_0000ffff');
  });
});

describe('formatJobDeckTraceLines', () => {
  it('renders assistant/user text and tool activity', () => {
    const lines = formatJobDeckTraceLines([
      {
        role: 'user',
        content: [{ type: 'text', text: 'fix the flaky test' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking at the suite now.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
          { type: 'tool_result', isError: false },
        ],
      },
    ]);
    expect(lines).toEqual([
      '◇ fix the flaky test',
      '◆ Looking at the suite now.',
      '⚙ Bash pnpm test',
      '✓ result',
    ]);
  });

  it('marks failed tool results and skips non-user roles', () => {
    const lines = formatJobDeckTraceLines([
      { role: 'system', content: [{ type: 'text', text: 'hidden' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_result', isError: true }],
      },
    ]);
    expect(lines).toEqual(['✗ result']);
  });

  it('caps output at maxLines with an omission marker', () => {
    const history = [
      {
        role: 'user',
        content: Array.from({ length: 10 }, (_, index) => ({
          type: 'text',
          text: `line ${String(index)}`,
        })),
      },
    ];
    const lines = formatJobDeckTraceLines(history, { maxLines: 3 });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('7 earlier lines omitted');
    expect(lines[3]).toBe('◇ line 9');
  });
});
