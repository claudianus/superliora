import { describe, expect, it } from 'vitest';

import { hitTestDockDivider, measureAnsiDisplayWidth, renderPanelFrame } from '../src';

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

describe('hitTestDockDivider pad', () => {
  const left = { x: 2, y: 1, width: 42, height: 40 };
  const right = { x: 146, y: 1, width: 52, height: 40 };

  it('hits left divider on the seam and one column inside the dock', () => {
    expect(hitTestDockDivider(44, 10, left, right)).toBe('left-dock-divider'); // seam
    expect(hitTestDockDivider(43, 10, left, right)).toBe('left-dock-divider'); // pad inside
    expect(hitTestDockDivider(45, 10, left, right)).toBe('left-dock-divider'); // pad toward center
  });

  it('hits right divider with pad', () => {
    expect(hitTestDockDivider(145, 10, left, right)).toBe('right-dock-divider');
    expect(hitTestDockDivider(144, 10, left, right)).toBe('right-dock-divider');
    expect(hitTestDockDivider(146, 10, left, right)).toBe('right-dock-divider');
  });
});
