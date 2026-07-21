import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderStatusBar } from '#/tui/utils/status-bar';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI_SGR, '');

describe('renderStatusBar', () => {
  const previousLevel = chalk.level;
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = previousLevel;
  });

  it('shows git branch, status label, model, context, cost, and time', () => {
    const line = strip(
      renderStatusBar(
        {
          gitBranch: 'main',
          agentStatus: 'working',
          contextUsage: 0.42,
          contextTokens: 84_000,
          maxContextTokens: 200_000,
          model: 'claude-sonnet-20250101',
          sessionCostUsd: 2.5,
        },
        120,
        '/tmp',
      ),
    );
    expect(line).toContain('main');
    expect(line).toContain('작업');
    expect(line).toContain('sonnet'); // shortened model (claude- prefix stripped)
    expect(line).toContain('84.0k/200.0k');
    expect(line).toContain('$2.50');
    expect(line).toMatch(/\d{2}:\d{2}/); // clock
  });

  it('pads the line to the full terminal width', () => {
    const line = strip(renderStatusBar({ agentStatus: 'idle', gitBranch: 'x' }, 80, '/tmp'));
    expect(line.length).toBe(80);
  });

  it('maps every agent status to its Korean label', () => {
    expect(strip(renderStatusBar({ agentStatus: 'idle', gitBranch: 'x' }, 60, '/tmp'))).toContain('대기');
    expect(strip(renderStatusBar({ agentStatus: 'thinking', gitBranch: 'x' }, 60, '/tmp'))).toContain('추론');
    expect(strip(renderStatusBar({ agentStatus: 'working', gitBranch: 'x' }, 60, '/tmp'))).toContain('작업');
    expect(strip(renderStatusBar({ agentStatus: 'error', gitBranch: 'x' }, 60, '/tmp'))).toContain('오류');
  });

  it('drops low-priority segments on narrow widths but keeps status and time', () => {
    const data = {
      gitBranch: 'main',
      agentStatus: 'working' as const,
      contextUsage: 0.9,
      contextTokens: 180_000,
      maxContextTokens: 200_000,
      model: 'claude-sonnet',
      sessionCostUsd: 1.5,
    };
    const wide = strip(renderStatusBar(data, 200, '/tmp'));
    const narrow = strip(renderStatusBar(data, 35, '/tmp'));

    // Wide bar carries every segment.
    expect(wide).toContain('180.0k/200.0k');
    expect(wide).toContain('$1.50');
    // Narrow bar keeps status + time but sheds the lowest-priority cost segment.
    expect(narrow).toContain('작업');
    expect(narrow).toMatch(/\d{2}:\d{2}/);
    expect(narrow).not.toContain('$1.50');
  });
});
