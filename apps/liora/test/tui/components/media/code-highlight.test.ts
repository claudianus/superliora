import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { highlightLines, langFromPath } from '#/tui/components/media/code-highlight';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

import { captureProcessWrite } from '../../../helpers/process';

describe('code-highlight', () => {
  const previousChalkLevel = chalk.level;

  afterEach(() => {
    chalk.level = previousChalkLevel;
    currentTheme.setPalette(darkColors);
  });

  it('maps known file extensions to supported highlight languages', () => {
    expect(langFromPath('src/foo.ts')).toBe('typescript');
    expect(langFromPath('src/foo.TS')).toBe('typescript');
  });

  it('treats unsupported file extensions as plain text', () => {
    expect(langFromPath('src/foo.abcxyz')).toBeUndefined();
  });

  it('does not call cli-highlight for unsupported languages', () => {
    const stderr = captureProcessWrite('stderr');
    try {
      expect(highlightLines('hello\nworld', 'abcxyz')).toEqual(['hello', 'world']);
      expect(stderr.text()).not.toContain('Could not find the language');
    } finally {
      stderr.restore();
    }
  });

  it('uses syntax color tokens from the active TUI theme', () => {
    chalk.level = 3;
    currentTheme.setPalette({
      ...darkColors,
      syntaxKeyword: '#123456',
    });

    const highlighted = highlightLines('const value = "kimi";', 'typescript').join('\n');

    expect(highlighted).toContain('\u001B[38;2;18;52;86m');
  });

  it('can highlight with an explicit palette without changing the active theme', () => {
    chalk.level = 3;
    currentTheme.setPalette(darkColors);

    const highlighted = highlightLines(
      'const value = "kimi";',
      'typescript',
      {
        ...darkColors,
        syntaxKeyword: '#654321',
      },
    ).join('\n');

    expect(highlighted).toContain('\u001B[38;2;101;67;33m');
    expect(currentTheme.palette).toBe(darkColors);
  });
});
