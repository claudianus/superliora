import { describe, expect, it } from 'vitest';

import {
  RendererTruncatedOutputComponent,
  withTranscriptMeasureMode,
} from '../src';

describe('RendererTruncatedOutputComponent deferred format', () => {
  it('skips formatText during geometry measure mode', () => {
    let formatCalls = 0;
    const component = new RendererTruncatedOutputComponent('hello\nworld\nextra', {
      expanded: false,
      maxLines: 2,
      formatText: (text) => {
        formatCalls += 1;
        return `FMT:${text}`;
      },
    });

    const measured = withTranscriptMeasureMode(() => component.render(80));
    expect(formatCalls).toBe(0);
    expect(measured.some((line) => line.includes('hello'))).toBe(true);
    expect(measured.some((line) => line.includes('FMT:'))).toBe(false);
  });

  it('formats sync on first real paint for small bodies', () => {
    let formatCalls = 0;
    const component = new RendererTruncatedOutputComponent('a\nb\nc', {
      expanded: false,
      maxLines: 2,
      formatText: (text) => {
        formatCalls += 1;
        return text
          .split('\n')
          .map((line) => `>${line}`)
          .join('\n');
      },
    });

    withTranscriptMeasureMode(() => component.render(80));
    expect(formatCalls).toBe(0);

    const painted = component.render(80);
    expect(formatCalls).toBe(1);
    expect(painted.some((line) => line.includes('>a'))).toBe(true);
  });

  it('paints plain first and defers formatText for large bodies', () => {
    const body = `${'x'.repeat(2_000)}\nline2\nline3\nline4`;
    let formatCalls = 0;
    let scheduled: (() => void) | undefined;
    const applied: string[] = [];

    const component = new RendererTruncatedOutputComponent(body, {
      expanded: false,
      maxLines: 2,
      deferFormatAboveChars: 100,
      formatText: (text) => {
        formatCalls += 1;
        return `FMT:${text.slice(0, 8)}`;
      },
      onDeferredFormat: (apply) => {
        scheduled = apply;
      },
      onFormatApplied: () => {
        applied.push('done');
      },
      formatPendingHint: () => '⠋ formatting',
    });

    const first = component.render(80);
    expect(formatCalls).toBe(0);
    expect(component.isFormatPending).toBe(true);
    expect(first.some((line) => line.includes('x'.repeat(8)))).toBe(true);
    expect(first.some((line) => line.includes('formatting'))).toBe(true);
    expect(scheduled).toBeTypeOf('function');

    scheduled?.();
    expect(formatCalls).toBe(1);
    expect(component.isFormatPending).toBe(false);
    expect(applied).toEqual(['done']);

    const second = component.render(80);
    expect(second.some((line) => line.includes('FMT:'))).toBe(true);
    expect(second.some((line) => line.includes('formatting'))).toBe(false);
  });

  it('does not schedule deferred format twice for the same body', () => {
    const body = 'y'.repeat(500);
    let scheduleCount = 0;
    const component = new RendererTruncatedOutputComponent(body, {
      expanded: true,
      deferFormatAboveChars: 10,
      formatText: (text) => `Z${text}`,
      onDeferredFormat: () => {
        scheduleCount += 1;
      },
    });

    component.render(40);
    component.render(40);
    component.render(40);
    expect(scheduleCount).toBe(1);
  });
});
