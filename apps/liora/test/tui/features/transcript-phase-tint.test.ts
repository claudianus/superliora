import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { darkColors } from '#/tui/theme/colors';
import {
  applyPhaseTintLine,
  formatPhaseHeaderLine,
  phaseGutter,
  phaseHeaderLabel,
} from '#/tui/features/transcript/transcript-phase-tint';

describe('transcript phase tint', () => {
  const prev = chalk.level;
  afterEach(() => {
    chalk.level = prev;
  });

  it('labels each work-unit phase', () => {
    expect(phaseHeaderLabel('thinking')).toBe('thinking');
    expect(phaseHeaderLabel('tools')).toBe('tools');
    expect(phaseHeaderLabel('answer')).toBe('answer');
  });

  it('paints gutter and soft background on headers', () => {
    chalk.level = 3;
    const gutter = phaseGutter('tools', darkColors);
    expect(gutter).toContain('▌');
    const line = formatPhaseHeaderLine('tools', '7 tools · +1/−0', 40, darkColors);
    expect(line).toContain('\u001B[');
    expect(line.replaceAll(/\u001B\[[0-9;]*m/g, '')).toMatch(/tools/);
  });

  it('pads tinted lines to width', () => {
    chalk.level = 3;
    const line = applyPhaseTintLine('hi', 12, 'answer', darkColors);
    // Background SGR present for full-width pad.
    expect(line).toContain('\u001B[48;2');
  });
});
