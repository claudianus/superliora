import { describe, expect, it } from 'vitest';

import {
  ANSI_ERASE_IN_LINE,
  defaultTerminalEraseLineMode,
  encodeTerminalRuns,
} from '../src';

const TRAILING_BLANK_RUN = {
  x: 0,
  y: 0,
  cells: [
    { char: 'o' },
    { char: 'k' },
    { char: ' ' },
    { char: ' ' },
    { char: ' ' },
    { char: ' ' },
    { char: ' ' },
    { char: ' ' },
  ],
};

describe('terminal erase-line output', () => {
  it('keeps CSI K on unix xterm when eraseLine is on', () => {
    expect(encodeTerminalRuns([TRAILING_BLANK_RUN], {
      eraseLine: true,
      frameWidth: 8,
    })).toBe(`\u001B[1;1Hok${ANSI_ERASE_IN_LINE}`);
  });

  it('writes themed spaces instead of CSI K on ConPTY-like hosts', () => {
    expect(encodeTerminalRuns([TRAILING_BLANK_RUN], {
      eraseLine: true,
      frameWidth: 8,
      eraseLineMode: 'spaces',
    })).toBe('\u001B[1;1Hok      ');
    expect(encodeTerminalRuns([TRAILING_BLANK_RUN], {
      eraseLine: true,
      frameWidth: 8,
      eraseLineMode: 'spaces',
    })).not.toContain(ANSI_ERASE_IN_LINE);
  });

  it('keeps the current SGR background when filling ConPTY trailing blanks', () => {
    const themedRun = {
      x: 0,
      y: 0,
      cells: [
        { char: 'o', style: { bg: '#112233' } },
        { char: 'k', style: { bg: '#112233' } },
        { char: ' ' },
        { char: ' ' },
        { char: ' ' },
        { char: ' ' },
      ],
    };
    const output = encodeTerminalRuns([themedRun], {
      eraseLine: true,
      frameWidth: 6,
      eraseLineMode: 'spaces',
    });
    expect(output).toContain('\u001B[0;48;2;17;34;51m');
    expect(output).toContain('ok    ');
    expect(output).not.toContain(ANSI_ERASE_IN_LINE);
  });

  it('defaults ConPTY / Windows Terminal hosts to space fill', () => {
    expect(defaultTerminalEraseLineMode({ platform: 'win32', env: {} })).toBe('spaces');
    expect(defaultTerminalEraseLineMode({ platform: 'linux', env: {} })).toBe('el');
    expect(defaultTerminalEraseLineMode({
      platform: 'darwin',
      env: { WT_SESSION: '1' },
    })).toBe('spaces');
  });
});
