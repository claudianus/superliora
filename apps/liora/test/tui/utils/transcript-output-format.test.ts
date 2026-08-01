import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';
import {
  detectTranscriptOutputKind,
  formatThinkingText,
  formatTranscriptOutput,
  formatTranscriptOutputDetailed,
} from '#/tui/utils/transcript/transcript-output-format';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('transcript-output-format', () => {
  const previousChalkLevel = chalk.level;

  afterEach(() => {
    chalk.level = previousChalkLevel;
    currentTheme.setPalette(darkColors);
  });

  describe('detectTranscriptOutputKind', () => {
    it('detects pretty-printable JSON objects and arrays', () => {
      expect(detectTranscriptOutputKind('{"a":1,"b":[2,3]}')).toBe('json');
      expect(detectTranscriptOutputKind('  [1, 2, 3]  ')).toBe('json');
    });

    it('detects JSONL streams', () => {
      const jsonl = ['{"id":1}', '{"id":2}', '{"id":3}'].join('\n');
      expect(detectTranscriptOutputKind(jsonl)).toBe('jsonl');
    });

    it('detects unified diffs', () => {
      const diff = [
        'diff --git a/foo.ts b/foo.ts',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1,2 +1,2 @@',
        '-old',
        '+new',
      ].join('\n');
      expect(detectTranscriptOutputKind(diff)).toBe('diff');
    });

    it('detects stack traces', () => {
      const stack = [
        'TypeError: cannot read property of undefined',
        '    at Object.foo (/Users/me/app/src/a.ts:10:5)',
        '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ].join('\n');
      expect(detectTranscriptOutputKind(stack)).toBe('stack');
    });

    it('detects log-level streams', () => {
      const logs = [
        'INFO starting server on :8080',
        'WARN config missing optional key',
        'ERROR failed to bind port',
      ].join('\n');
      expect(detectTranscriptOutputKind(logs)).toBe('log');
    });

    it('falls back to plain for prose', () => {
      expect(detectTranscriptOutputKind('hello world\nnext line')).toBe('plain');
    });
  });

  describe('formatTranscriptOutput', () => {
    it('pretty-prints JSON and keeps content intact under ANSI', () => {
      chalk.level = 3;
      const raw = '{"name":"liora","ok":true}';
      const detailed = formatTranscriptOutputDetailed(raw);
      expect(detailed.kind).toBe('json');
      const plain = strip(detailed.text);
      expect(plain).toContain('"name"');
      expect(plain).toContain('liora');
      expect(plain).toContain('\n');
      expect(detailed.text).toContain('\u001B[');
    });

    it('highlights log levels with distinct colours', () => {
      chalk.level = 3;
      const out = formatTranscriptOutput('ERROR boom\nINFO ok\nDEBUG quiet');
      expect(out).toContain('\u001B[');
      expect(strip(out)).toContain('ERROR boom');
      expect(strip(out)).toContain('INFO ok');
    });

    it('soft-decorates URLs and paths in plain text', () => {
      chalk.level = 3;
      const out = formatTranscriptOutput('see https://example.com/docs and ./src/main.ts');
      expect(out).toContain('\u001B[');
      expect(strip(out)).toContain('https://example.com/docs');
      expect(strip(out)).toContain('./src/main.ts');
    });

    it('colours stack frames without inventing text', () => {
      chalk.level = 3;
      const stack = [
        'Error: fail',
        '    at run (/tmp/work/app.ts:12:3)',
      ].join('\n');
      const detailed = formatTranscriptOutputDetailed(stack);
      expect(detailed.kind).toBe('stack');
      expect(strip(detailed.text)).toBe(stack);
      expect(detailed.text).toContain('\u001B[');
    });

    it('never throws on empty or huge plain input', () => {
      expect(formatTranscriptOutput('')).toBe('');
      const huge = 'x'.repeat(500_000);
      expect(() => formatTranscriptOutput(huge)).not.toThrow();
      expect(strip(formatTranscriptOutput(huge)).length).toBe(huge.length);
    });

    it('error mode keeps content and applies error tint for plain blobs', () => {
      chalk.level = 3;
      const out = formatTranscriptOutput('plain failure', { isError: true });
      expect(strip(out)).toBe('plain failure');
      expect(out).toContain('\u001B[');
    });
  });

  describe('formatThinkingText', () => {
    it('keeps prose italic-dim and lifts list bullets', () => {
      chalk.level = 3;
      const out = formatThinkingText('- first step\nplain thought');
      expect(strip(out)).toContain('first step');
      expect(strip(out)).toContain('plain thought');
      expect(out).toContain('\u001B[');
    });

    it('highlights fenced code blocks inside thinking', () => {
      chalk.level = 3;
      const text = ['before', '```ts', 'const x = 1;', '```', 'after'].join('\n');
      const out = formatThinkingText(text);
      expect(strip(out)).toContain('const x = 1;');
      expect(strip(out)).toContain('before');
      expect(out).toContain('\u001B[');
    });
  });
});
