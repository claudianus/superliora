import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { TurnPhaseBoundaryComponent } from '#/tui/components/messages/turn-phase-boundary';

describe('TurnPhaseBoundaryComponent', () => {
  const prev = chalk.level;
  afterEach(() => {
    chalk.level = prev;
  });

  it('renders a phase header line with detail', () => {
    chalk.level = 3;
    const boundary = new TurnPhaseBoundaryComponent('tools', '3 tools');
    const lines = boundary.render(48);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const plain = lines.join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
    expect(plain).toMatch(/tools/);
    expect(plain).toContain('3 tools');
  });
});
