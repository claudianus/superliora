import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it } from 'vitest';

import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';


function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '');
}

describe('TruncatedOutputComponent', () => {
  it('indents content and the truncation hint by the configured amount', () => {
    const component = new TruncatedOutputComponent(['a', 'b', 'c', 'd', 'e'].join('\n'), {
      expanded: false,
      isError: false,
      maxLines: 2,
      indent: 6,
    });

    const lines = strip(component.render(80).join('\n')).split('\n');
    expect(lines[0]?.startsWith('      a')).toBe(true);
    expect(lines[1]?.startsWith('      b')).toBe(true);
    expect(lines[2]).toBe('      ⋯ 3 more lines — scroll to expand');
  });

  it('defaults to a two-space indent for both content and hint', () => {
    const component = new TruncatedOutputComponent('x\ny\nz', {
      expanded: false,
      isError: false,
      maxLines: 1,
    });

    const lines = strip(component.render(80).join('\n')).split('\n');
    expect(lines[0]?.startsWith('  x')).toBe(true);
    expect(lines[1]).toBe('  ⋯ 2 more lines — scroll to expand');
  });

  it('omits the ctrl+o promise when expandHint is false', () => {
    const component = new TruncatedOutputComponent('a\nb\nc\nd', {
      expanded: false,
      isError: false,
      maxLines: 2,
      indent: 4,
      expandHint: false,
    });

    const lines = strip(component.render(80).join('\n')).split('\n');
    expect(lines[2]).toBe('    ... (2 more lines)');
  });

  it('renders all lines without a hint when expanded', () => {
    const component = new TruncatedOutputComponent('a\nb\nc\nd', {
      expanded: true,
      isError: false,
      maxLines: 2,
      indent: 4,
    });

    const out = strip(component.render(80).join('\n'));
    expect(out).toContain('d');
    expect(out).not.toContain('more lines, ctrl+o');
  });

  it('keeps the truncation footer within the requested render width', () => {
    const output = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`).join('\n');
    const component = new TruncatedOutputComponent(output, {
      expanded: false,
      isError: false,
      maxLines: 3,
      indent: 2,
    });

    for (const line of component.render(37)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(37);
    }
  });

  it('restores the ctrl+o wording when hintMode is key', () => {
    const component = new TruncatedOutputComponent('a\nb\nc', {
      expanded: false,
      isError: false,
      maxLines: 1,
      hintMode: 'key',
    });

    const lines = strip(component.render(80).join('\n')).split('\n');
    expect(lines[1]).toBe('  ... (2 more lines, ctrl+o to expand)');
  });

  it('keeps the plain footer when expandHint is false, even in scroll mode', () => {
    const component = new TruncatedOutputComponent('a\nb\nc\nd', {
      expanded: false,
      isError: false,
      maxLines: 2,
      expandHint: false,
    });

    const lines = strip(component.render(80).join('\n')).split('\n');
    expect(lines[2]).toBe('  ... (2 more lines)');
  });

  it('omits the scroll hint for output that fits the preview cap', () => {
    const component = new TruncatedOutputComponent('a\nb', {
      expanded: false,
      isError: false,
      maxLines: 3,
    });

    const out = strip(component.render(80).join('\n'));
    expect(out).not.toContain('scroll to expand');
    expect(out).not.toContain('more lines');
  });

  it('keeps the scroll hint within the requested render width', () => {
    const output = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`).join('\n');
    const component = new TruncatedOutputComponent(output, {
      expanded: false,
      isError: false,
      maxLines: 3,
      indent: 2,
    });

    const lines = component.render(37);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(37);
    }
    expect(strip(lines.at(-1) ?? '')).toContain('scroll to expand');
  });
});
