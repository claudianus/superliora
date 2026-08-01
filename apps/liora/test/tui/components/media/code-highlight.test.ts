import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearHighlightCache,
  formatShellCommandPreview,
  HIGHLIGHT_CACHE_LIMIT,
  highlightCacheSizeForTest,
  highlightLines,
  highlightLinesWindow,
  highlightShellCommandLine,
  langFromPath,
} from '#/tui/components/media/code-highlight';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

import {
  __forceShikiFallbackForTest,
  warmShikiHighlighter,
} from '#/tui/components/media/shiki-ansi';

import { captureProcessWrite } from '../../../helpers/process';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('code-highlight', () => {
  const previousChalkLevel = chalk.level;

  afterEach(() => {
    chalk.level = previousChalkLevel;
    currentTheme.setPalette(darkColors);
    clearHighlightCache();
  });

  it('maps known file extensions to supported highlight languages', () => {
    expect(langFromPath('src/foo.ts')).toBe('typescript');
    expect(langFromPath('src/foo.TS')).toBe('typescript');
    expect(langFromPath('Dockerfile')).toBe('dockerfile');
    expect(langFromPath('scripts/run.sh')).toBe('bash');
  });

  it('keeps path-hinted sticky entries under thrash past the soft limit', () => {
    chalk.level = 3;
    const stickyCode = 'const stickyValue = 1;\n';
    highlightLines(stickyCode, 'typescript', { pathHint: 'src/sticky.ts' });
    expect(highlightCacheSizeForTest()).toBeGreaterThanOrEqual(1);

    // Flood the LRU with non-sticky one-offs past the cap.
    for (let i = 0; i < HIGHLIGHT_CACHE_LIMIT + 20; i++) {
      highlightLines(`const n${String(i)} = ${String(i)};\n`, 'typescript');
    }
    // Sticky body must still hit without re-tokenizing from empty.
    const again = highlightLines(stickyCode, 'typescript', { pathHint: 'src/sticky.ts' });
    expect(again.join('\n')).toContain('stickyValue');
    expect(highlightCacheSizeForTest()).toBeLessThanOrEqual(HIGHLIGHT_CACHE_LIMIT);
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
    // Palette token routing lives in the cli-highlight fallback engine.
    __forceShikiFallbackForTest(true);
    try {
      chalk.level = 3;
      currentTheme.setPalette({
        ...darkColors,
        syntaxKeyword: '#123456',
      });

      const highlighted = highlightLines('const value = "kimi";', 'typescript').join('\n');

      expect(highlighted).toContain('\u001B[38;2;18;52;86m');
    } finally {
      __forceShikiFallbackForTest(false);
    }
  });

  it('can highlight with an explicit palette without changing the active theme', () => {
    __forceShikiFallbackForTest(true);
    try {
      chalk.level = 3;
      currentTheme.setPalette(darkColors);

      const highlighted = highlightLines('const value = "kimi";', 'typescript', {
        ...darkColors,
        syntaxKeyword: '#654321',
      }).join('\n');

      expect(highlighted).toContain('\u001B[38;2;101;67;33m');
      expect(currentTheme.palette).toBe(darkColors);
    } finally {
      __forceShikiFallbackForTest(false);
    }
  });

  it('prefers Shiki TextMate tokenization once warmed up', async () => {
    chalk.level = 3;
    await warmShikiHighlighter();
    const highlighted = highlightLines('const value = "kimi";', 'typescript').join('\n');
    // Truecolor foreground sequences over the untouched source text.
    expect(highlighted).toContain('\u001B[38;2;');
    expect(highlighted.replaceAll(/\u001B\[[0-9;]*m/g, '')).toContain('const value = "kimi";');
  });

  it('windowed highlight only tokenizes the requested range for large files', () => {
    chalk.level = 3;
    const lines = Array.from({ length: 500 }, (_, i) =>
      i === 10 ? 'const answer = 42;' : `// line ${String(i)}`,
    );
    const code = lines.join('\n');
    const highlighted = highlightLinesWindow(code, 'typescript', {
      startLine: 8,
      endLine: 14,
      maxHighlightLines: 50,
    });
    expect(highlighted).toHaveLength(500);
    // The window around the const line should carry ANSI; distant plain comments may not.
    expect(highlighted[10]).toContain('\u001B[');
    expect(stripAnsi(highlighted[10]!)).toContain('const answer = 42;');
  });

  it('highlights shell command binaries, flags, and strings', () => {
    chalk.level = 3;
    const line = highlightShellCommandLine('rg -n "TODO" src/**/*.ts | head -n 20');
    const plain = stripAnsi(line);
    expect(plain).toContain('rg');
    expect(plain).toContain('-n');
    expect(plain).toContain('"TODO"');
    // Expect multiple color runs (not a single dim blob).
    const ansiRuns = line.match(/\u001B\[[0-9;]*m/g) ?? [];
    expect(ansiRuns.length).toBeGreaterThan(2);
  });

  it('formats shell preview with a dim $ prompt and colored body', () => {
    chalk.level = 3;
    const lines = formatShellCommandPreview('pnpm -C apps/liora test');
    expect(stripAnsi(lines[0]!)).toMatch(/^\$ pnpm /);
    expect(lines[0]).toContain('\u001B[');
  });
});
