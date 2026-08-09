import { describe, expect, it } from 'vitest';

import {
  CHROME_BAND_LEFT_MARGIN,
  chromeBandInteriorWidth,
  renderRoundedPanel,
} from '#/tui/utils/ui/panel-frame';

import { stripAnsi } from './frame-stability-helpers';

describe('renderRoundedPanel', () => {
  it('renders a rounded box with title and content', () => {
    const lines = renderRoundedPanel({
      title: ' Panel ',
      content: ['alpha', 'beta'],
      width: 40,
    });

    const output = stripAnsi(lines.join('\n'));
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

    const output = stripAnsi(lines.join('\n'));
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

  it('fillWidth stretches the frame to the requested width', () => {
    const width = 72;
    const shrink = renderRoundedPanel({
      title: ' Mission Control · 2 active ',
      content: ['● plan ◌ short'],
      width,
    });
    const filled = renderRoundedPanel({
      title: ' Mission Control · 2 active ',
      content: ['● plan ◌ short'],
      width,
      fillWidth: true,
    });
    const shrinkTop = stripAnsi(shrink[0] ?? '');
    const filledTop = stripAnsi(filled[0] ?? '');
    expect(filledTop.length).toBe(width);
    expect(filledTop.length).toBeGreaterThan(shrinkTop.length);
    expect(filledTop.startsWith('╭')).toBe(true);
    expect(filledTop.endsWith('╮')).toBe(true);
  });

  it('aligns chrome-band frames on the same left and right columns', () => {
    const width = 80;
    const todo = renderRoundedPanel({
      title: ' Todo Board · 1/3 done ',
      content: ['meta', 'doing | next | done'],
      width,
      leftMargin: CHROME_BAND_LEFT_MARGIN,
      fillWidth: true,
    });
    const dock = renderRoundedPanel({
      title: ' Worker Dock · 1 worker ',
      content: ['FLEET 1', 'BOARD'],
      width,
      leftMargin: CHROME_BAND_LEFT_MARGIN,
      fillWidth: true,
    });
    const todoTop = stripAnsi(todo[0] ?? '');
    const dockTop = stripAnsi(dock[0] ?? '');
    expect(todoTop.length).toBe(width);
    expect(dockTop.length).toBe(width);
    expect(todoTop.indexOf('╭')).toBe(CHROME_BAND_LEFT_MARGIN);
    expect(dockTop.indexOf('╭')).toBe(CHROME_BAND_LEFT_MARGIN);
    expect(todoTop.endsWith('╮')).toBe(true);
    expect(dockTop.endsWith('╮')).toBe(true);
    expect(chromeBandInteriorWidth(width)).toBe(width - CHROME_BAND_LEFT_MARGIN - 4);
  });
});
