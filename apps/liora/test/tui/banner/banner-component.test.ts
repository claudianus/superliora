import { describe, expect, it } from 'vitest';

import { BannerComponent } from '#/tui/components/chrome/banner';

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI stripping for assertions
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '').replaceAll(/\u001B\][^\u0007]*\u0007/g, '');
}

describe('BannerComponent', () => {
  it('keeps the tag inline with the main text when it fits', () => {
    const banner = new BannerComponent({ key: 'test', tag: 'Tips', mainText: 'Hello world', subText: null, display: 'always' });
    const lines = banner.render(80).map(stripAnsi);
    expect(lines.some((line) => line.includes('✦ Tips') && line.includes('Hello world'))).toBe(
      true,
    );
  });

  it('renders the tag on its own line when the terminal is too narrow (was silently dropped)', () => {
    const banner = new BannerComponent({
      key: 'test',
      tag: 'A very long tag label that alone exceeds the width',
      mainText: 'Hello world',
      subText: null,
      display: 'always',
    });
    const lines = banner.render(30).map(stripAnsi);
    // The tag survives, truncated, on its own line.
    expect(lines.some((line) => line.startsWith('✦ A very long tag'))).toBe(true);
    // The main text still renders in full below it.
    expect(lines.some((line) => line.includes('Hello world'))).toBe(true);
  });

  it('keeps every rendered line within the terminal width', () => {
    const banner = new BannerComponent({
      key: 'test',
      tag: 'Tips',
      mainText: 'A reasonably long main banner line',
      subText: 'a subtext line that is also fairly long in this test',
      display: 'always',
    });
    for (const width of [16, 24, 40]) {
      for (const line of banner.render(width)) {
        expect(line.length).toBeLessThanOrEqual(width + 1);
      }
    }
  });
});
