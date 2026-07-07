import type { RendererRootUI } from '#/tui/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoonLoader } from '#/tui/components/chrome/moon-loader';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const loaders: MoonLoader[] = [];

function createLoader(
  style?: ConstructorParameters<typeof MoonLoader>[1],
  colorFn?: ConstructorParameters<typeof MoonLoader>[2],
  label?: ConstructorParameters<typeof MoonLoader>[3],
): MoonLoader {
  const loader = new MoonLoader({ requestRender: vi.fn() } as unknown as RendererRootUI, style, colorFn, label);
  loaders.push(loader);
  return loader;
}

afterEach(() => {
  for (const loader of loaders) loader.stop();
  loaders.length = 0;
  vi.useRealTimers();
});

describe('MoonLoader', () => {
  it('shows elapsed time next to a labeled spinner', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader('braille', undefined, 'working...');

    expect(strip(loader.renderInline())).toContain('working... 0s');

    vi.advanceTimersByTime(1_100);
    expect(strip(loader.renderInline())).toContain('working... 1s');
  });

  it('shows elapsed time when the spinner has no label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader();

    expect(strip(loader.renderInline())).toContain('0s');

    vi.advanceTimersByTime(61_000);
    loader.setAvailableWidth(80);
    expect(strip(loader.renderInline())).toContain('1m01s');
  });

  it('keeps the tip out of inline rendering for swarm progress lines', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader('moon', undefined, 'working...');
    loader.setTip(' · Tip: ctrl+s: steer mid-turn');
    loader.setAvailableWidth(80);

    const inline = strip(loader.renderInline());
    expect(inline).toContain('working... 0s');
    expect(inline).not.toContain('Tip');
    expect(inline).not.toContain('steer');
  });

  it('renders only the animated glyph for dense swarm embeds', () => {
    const loader = createLoader('braille', undefined, 'working...');
    const glyph = strip(loader.renderGlyph());
    const inline = strip(loader.renderInline());

    expect(glyph.length).toBeGreaterThan(0);
    expect(inline).toContain('working...');
    expect(glyph).not.toContain('working...');
    expect(glyph).not.toContain('0s');
  });

  it('still shows the tip on the activity row when width allows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader('moon', undefined, 'working...');
    loader.setTip(' · Tip: ctrl+s: steer mid-turn');
    loader.setAvailableWidth(80);

    const row = strip(loader.render(80).join('\n'));
    expect(row).toContain('Tip: ctrl+s: steer mid-turn');
  });
});
