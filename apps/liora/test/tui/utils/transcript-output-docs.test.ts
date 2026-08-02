import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearTranscriptFormatCache,
  detectTranscriptOutputKind,
  formatTranscriptOutput,
} from '#/tui/utils/transcript/transcript-output-format';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('transcript document formatters', () => {
  const prev = chalk.level;
  afterEach(() => {
    chalk.level = prev;
    clearTranscriptFormatCache();
  });

  it('detects and colors CSV columns', () => {
    chalk.level = 3;
    const csv = 'name,age,city\nalice,30,seoul\nbob,25,busan\n';
    expect(detectTranscriptOutputKind(csv)).toBe('csv');
    const out = formatTranscriptOutput(csv);
    expect(stripAnsi(out)).toContain('alice');
    expect(out).toContain('\u001B[38;2');
  });

  it('detects KEY=value properties dumps', () => {
    chalk.level = 3;
    const props = 'FOO=1\nBAR=hello\nBAZ=world\nQUX=true\n';
    expect(detectTranscriptOutputKind(props)).toBe('properties');
    const out = formatTranscriptOutput(props);
    expect(stripAnsi(out)).toContain('FOO');
    expect(out).toContain('\u001B[38;2');
  });

  it('does not treat short prose as properties', () => {
    expect(detectTranscriptOutputKind('Hello world: this is prose.')).toBe('plain');
  });
});
