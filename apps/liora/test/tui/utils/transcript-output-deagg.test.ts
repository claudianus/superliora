import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearTranscriptFormatCache,
  detectTranscriptOutputKind,
  formatTranscriptOutput,
  sniffCodeLanguage,
} from '#/tui/utils/transcript/transcript-output-format';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('transcript output de-aggression', () => {
  const previousLevel = chalk.level;

  afterEach(() => {
    chalk.level = previousLevel;
    clearTranscriptFormatCache();
  });

  it('does not treat short prose with common keywords as code', () => {
    expect(sniffCodeLanguage('We should export the const later.')).toBeUndefined();
    expect(detectTranscriptOutputKind('We should export the const later.')).toBe('plain');
  });

  it('does not rainbow-color numbers in plain tool dumps', () => {
    chalk.level = 3;
    const text = 'Processed 42 files in 3 directories under report mode.';
    const out = formatTranscriptOutput(text, { mode: 'tool' });
    // Plain base may wrap the whole line, but individual digit tokens should
    // not get a distinct number color span separate from the base.
    const plain = stripAnsi(out);
    expect(plain).toContain('42');
    expect(plain).toContain('3');
    // No separate RGB for numbers: either full-line dim or path/url accents only.
    const numberSpans = [...out.matchAll(/\u001B\[38;2;\d+;\d+;\d+m\d+/g)];
    // Soft decorate used to paint every number — we assert fewer than 2 isolated digit paints.
    expect(numberSpans.length).toBeLessThan(2);
  });

  it('still sniffs multi-line typescript', () => {
    const sample = `export function hello(): void {\n  return;\n}\n`;
    expect(sniffCodeLanguage(sample)).toBe('typescript');
  });
});
