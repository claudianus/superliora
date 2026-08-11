import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { ansiTextToCells } from '#/tui/renderer';
import { darkColors } from '#/tui/theme/colors';
import {
  applyPhaseTintLine,
  applyWorkBlockTintLine,
  formatPhaseHeaderLine,
  isWorkBlockPhase,
  phaseGutter,
  phaseHeaderLabel,
  phaseTintHex,
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

  it('shares one work-block tint for thinking and tools', () => {
    expect(isWorkBlockPhase('thinking')).toBe(true);
    expect(isWorkBlockPhase('tools')).toBe(true);
    expect(isWorkBlockPhase('answer')).toBe(false);
    expect(phaseTintHex('thinking', darkColors)).toBe(phaseTintHex('tools', darkColors));
    expect(phaseTintHex('thinking', darkColors)).not.toBe(phaseTintHex('answer', darkColors));
  });

  it('paints blank work-block rows with the same fill', () => {
    chalk.level = 3;
    const blank = applyWorkBlockTintLine('', 8, 'tools', darkColors);
    expect(blank).toContain('\u001B[48;2');
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

  it('keeps tint bg on trailing pad after a styled-line reset', () => {
    chalk.level = 3;
    // Tool body lines end with Text.closeLine's \x1b[0m before phase tint pads.
    const styled = `${chalk.hex(darkColors.syntaxKeyword)('PASS')}\u001B[0m`;
    const line = applyPhaseTintLine(styled, 20, 'tools', darkColors);
    const tint = phaseTintHex('tools', darkColors).toLowerCase();
    const cells = ansiTextToCells(line);
    expect(cells.length).toBe(20);
    for (const cell of cells) {
      if (cell.continuation === true || cell.width === 0) continue;
      expect(cell.style?.bg?.toLowerCase()).toBe(tint);
    }
  });
});
