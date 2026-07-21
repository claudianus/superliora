import { describe, expect, it } from 'vitest';

import { measureAnsiDisplayWidth, renderPanelFrame } from '../src';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('renderPanelFrame ANSI safety', () => {
  it('keeps chalk SGR intact and pads by visible width', () => {
    const styled = '\u001B[38;2;90;90;90mhello\u001B[39m';
    const lines = renderPanelFrame({
      width: 14,
      height: 3,
      title: 'Dock',
      content: [styled],
      borderColor: (t) => `\u001B[2m${t}\u001B[22m`,
    });

    expect(lines).toHaveLength(3);
    const mid = lines[1]!;
    // Visible payload survives; byte-wise slice must not orphan SGR bodies.
    expect(strip(mid)).toContain('hello');
    expect(mid).toContain('\u001B[38;2;90;90;90m');
    expect(mid).not.toMatch(/(?<!\u001B)\[[0-9;]*38;2/);
    // Inner content + borders: visible width equals frame width.
    expect(measureAnsiDisplayWidth(mid)).toBe(14);
  });

  it('does not byte-slice styled title bars mid-escape', () => {
    const lines = renderPanelFrame({
      width: 20,
      height: 2,
      title: 'Files',
      icon: '📂',
      focused: true,
      content: [],
      titleColor: (t) => `\u001B[1;38;2;230;57;70m${t}\u001B[22;39m`,
      iconColor: (t) => `\u001B[38;2;61;155;255m${t}\u001B[39m`,
      borderColor: (t) => `\u001B[38;2;122;162;247m${t}\u001B[39m`,
    });

    const top = lines[0]!;
    expect(strip(top)).toContain('Files');
    // ESC-stripped SGR bodies (the dock garbage pattern) must not appear.
    expect(top).not.toMatch(/(?<!\u001B)\[[0-9;]*38;2/);
  });
});
