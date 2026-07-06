import { describe, expect, it } from 'vitest';

import { renderRoundedPanel } from '#/tui/utils/panel-frame';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('renderRoundedPanel', () => {
  it('renders a rounded box with title and content', () => {
    const lines = renderRoundedPanel({
      title: ' Panel ',
      content: ['alpha', 'beta'],
      width: 40,
    });

    const output = strip(lines.join('\n'));
    expect(output).toContain('╭');
    expect(output).toContain('╯');
    expect(output).toContain('Panel');
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
  });

  it('falls back to flat content when width is below minBoxWidth', () => {
    const lines = renderRoundedPanel({
      title: ' Panel ',
      content: ['alpha'],
      width: 20,
      minBoxWidth: 24,
    });

    const output = strip(lines.join('\n'));
    expect(output).not.toContain('╭');
    expect(output).toContain('alpha');
  });

  it('applies left margin to boxed output', () => {
    const lines = renderRoundedPanel({
      title: ' Panel ',
      content: ['alpha'],
      width: 40,
      leftMargin: 2,
    });

    expect(lines[0]?.startsWith('  ')).toBe(true);
  });
});
