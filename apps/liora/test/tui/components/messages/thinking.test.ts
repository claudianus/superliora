import { visibleWidth, type RendererRootUI } from '#/tui/renderer';
import { describe, expect, it, vi } from 'vitest';

import { ThinkingComponent } from '#/tui/components/messages/thinking';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { advanceAppearanceAnimationClock } from '#/tui/utils/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const longThinking = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');

describe('ThinkingComponent', () => {
  it('shows the live spinner header and a short content glance while streaming', () => {
    advanceAppearanceAnimationClock(0);
    const component = new ThinkingComponent('working it out', true, 'live');
    const out = strip(component.render(80).join('\n'));

    expect(out).toContain('⠋ thinking...');
    expect(out).not.toContain('  ⠋ thinking...');
    expect(out).not.toContain(`${STATUS_BULLET}⠋`);
    // Live thinking surfaces a short tail glance so progress is transparent.
    expect(out).toContain('working it out');
  });

  it('shows only the live thinking tail while collapsed', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    const out = strip(component.render(80).join('\n'));

    expect(out).not.toContain('line1');
    expect(out).not.toContain('line2');
    expect(out).not.toContain('line3');
    expect(out).not.toContain('line4');
    expect(out).not.toContain('line5');
    expect(out).not.toContain('line6');
    expect(out).toContain('line7');
    expect(out).not.toContain('ctrl+o to expand');
  });

  it('keeps expanded live thinking height-limited to a longer tail', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.setExpanded(true);
    const out = strip(component.render(80).join('\n'));

    expect(out).not.toContain('line1');
    // Expanded live thinking is height-capped to max(preview, 4).
    expect(out).not.toContain('line2');
    expect(out).not.toContain('line3');
    expect(out).toContain('line4');
    expect(out).toContain('line6');
    expect(out).toContain('line7');
    expect(out).not.toContain('ctrl+o to expand');
  });

  it('advances the live spinner frame with the animation clock and stops on finalize', () => {
    advanceAppearanceAnimationClock(0);
    const component = new ThinkingComponent('step', true, 'live', {
      requestRender: vi.fn(),
    } as unknown as RendererRootUI);

    // Frame 0 at time 0.
    expect(strip(component.render(80).join('\n'))).toContain('⠋ thinking...');

    // Advance the animation clock by one spinner interval → frame 1.
    advanceAppearanceAnimationClock(80);
    expect(strip(component.render(80).join('\n'))).toContain('⠙ thinking...');

    // After finalize the spinner line is replaced by the "thinking complete"
    // summary — no spinner glyph should appear.
    component.finalize();
    const finalized = strip(component.render(80).join('\n'));
    expect(finalized).not.toContain('⠙');
    expect(finalized).toContain('thinking complete');
  });

  it('finalizes in place into a hidden collapsed summary', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');

    component.finalize();

    const out = strip(component.render(80).join('\n'));
    expect(out).toContain('thinking complete');
    expect(out).toContain('... (7 lines hidden, ctrl+o to expand)');
    expect(out).not.toContain('line1');
    expect(out).not.toContain('line2');
    expect(out).not.toContain('line3');
    expect(out).not.toContain('line4');
  });

  it('reuses rendered line arrays at the same width until display state changes', () => {
    const component = new ThinkingComponent(longThinking, true, 'finalized');
    const first = component.render(80);
    const second = component.render(80);

    expect(second).toBe(first);

    component.setExpanded(true);
    expect(component.render(80)).not.toBe(first);
  });

  it('shows elapsed time while live and keeps it after finalization', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const component = new ThinkingComponent('step', true, 'live', {
      requestRender: vi.fn(),
    } as unknown as RendererRootUI);

    expect(strip(component.render(80).join('\n'))).toContain('thinking... 0s');

    vi.advanceTimersByTime(65_000);
    expect(strip(component.render(80).join('\n'))).toContain('thinking... 1m05s');

    component.finalize();
    expect(strip(component.render(80).join('\n'))).toContain('thinking complete 1m05s');

    vi.advanceTimersByTime(10_000);
    expect(strip(component.render(80).join('\n'))).toContain('thinking complete 1m05s');
    vi.useRealTimers();
  });

  it('expands and collapses after finalization', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    component.setExpanded(true);
    const expanded = strip(component.render(80).join('\n'));
    expect(expanded).toContain('line7');
    expect(expanded).not.toContain('ctrl+o to expand');

    component.setExpanded(false);
    const collapsed = strip(component.render(80).join('\n'));
    expect(collapsed).toContain('thinking complete');
    expect(collapsed).not.toContain('line7');
    expect(collapsed).toContain('ctrl+o to expand');
  });

  it('keeps the finalized truncation footer within the requested render width', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    for (const line of component.render(37)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(37);
    }
  });
});
