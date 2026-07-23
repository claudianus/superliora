import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderActivityTicker } from '#/tui/utils/activity-ticker';
import type { ActivityEntry } from '#/tui/utils/activity-ticker';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI_SGR, '');

function entry(kind: ActivityEntry['kind'], label: string, msAgo = 0): ActivityEntry {
  return { id: 'a1', timestamp: Date.now() - msAgo, kind, label } as ActivityEntry;
}

describe('renderActivityTicker', () => {
  const previousLevel = chalk.level;
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = previousLevel;
  });

  it('shows the idle placeholder when there is no activity', () => {
    const line = strip(renderActivityTicker(undefined, false, 60));
    expect(line).toContain('대기 중');
    expect(line.length).toBe(60);
  });

  it('shows the latest entry label and elapsed time', () => {
    const line = strip(renderActivityTicker(entry('tool-start', 'Reading file.ts', 5_000), true, 80));
    expect(line).toContain('Reading file.ts');
    expect(line).toContain('5초 전');
    expect(line.length).toBe(80);
  });

  it('truncates long labels to fit the column width', () => {
    const line = strip(renderActivityTicker(entry('command', 'x'.repeat(200)), true, 40));
    expect(line.length).toBe(40);
    expect(line).toContain('…');
  });
});
