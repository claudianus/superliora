import { visibleWidth } from '#/tui/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceCodeBoxComponent } from '#/tui/components/chrome/device-code-box';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const TL = '\u256D';
const TR = '\u256E';
const BL = '\u2570';
const BR = '\u256F';
const ELLIPSIS = '\u2026';

const url = 'https://www.kimi.com/code/authorize_device?user_code=N32D-W3YD';
const code = 'N32D-W3YD';
const title = 'Sign in to SuperLiora';
const hint = 'Press Ctrl-C to cancel';

const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
};

afterEach(() => {
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.useRealTimers();
});

function enablePremiumAmbient(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'premium',
  });
}

describe('DeviceCodeBoxComponent', () => {
  it('renders a rounded border that frames the title, url and code', () => {
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
      hint,
    });

    const lines = component.render(80).map(strip);
    const joined = lines.join('\n');
    const top = lines.find((line) => line.startsWith(TL));
    const bottom = lines.findLast((line) => line.startsWith(BL));

    expect(top?.startsWith(TL)).toBe(true);
    expect(top?.endsWith(TR)).toBe(true);
    expect(bottom?.startsWith(BL)).toBe(true);
    expect(bottom?.endsWith(BR)).toBe(true);
    expect(top).toContain(title);

    expect(joined).toContain(title);
    expect(joined).toContain(url);
    expect(joined).toContain(code);
    expect(joined).toContain(hint);
    expect(joined).toContain('Verification code');
  });

  it('embeds the cancel hint in the bottom border', () => {
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
      hint,
    });

    const bottom = component
      .render(80)
      .map(strip)
      .find((line) => line.startsWith(BL));
    expect(bottom).toContain(hint);
  });

  it('truncates long urls when the terminal is narrow', () => {
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
    });

    const lines = component.render(40).map(strip);
    const urlLine = lines.find((line) => line.includes('https://'));
    expect(urlLine).toBeDefined();
    expect(urlLine).toContain(ELLIPSIS);
    expect(urlLine?.length).toBeLessThanOrEqual(40);
  });

  it('omits the hint row when no hint is provided', () => {
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
    });

    const joined = component.render(80).map(strip).join('\n');
    expect(joined).not.toContain('Press Ctrl-C');
  });

  it('keeps every line within narrow widths', () => {
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
      hint,
    });

    for (const width of [39, 20, 10, 4]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('uses a static borderFocus frame when motion is off', () => {
    process.env['TERM'] = 'dumb';
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
    });
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
      hint,
    });
    const lines = component.render(80);
    const top = lines.find((line) => strip(line).startsWith(TL));
    expect(top).toBeDefined();
    const codes = new Set(top!.match(/\u001B\[[0-9;]*m/g) ?? []);
    // Static frame: one border hue, not a comet trail of many.
    expect(codes.size).toBeLessThanOrEqual(3);
  });

  it('animates the live frame across ticks under premium motion', () => {
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const component = new DeviceCodeBoxComponent({
      title,
      url,
      code,
      hint,
    });
    const first = component.render(80);
    const top = first.find((line) => strip(line).startsWith(TL));
    expect(top).toBeDefined();
    const codes = new Set(top!.match(/\u001B\[[0-9;]*m/g) ?? []);
    expect(codes.size).toBeGreaterThan(2);

    vi.setSystemTime(new Date('2026-08-20T00:00:02Z'));
    advanceAppearanceAnimationClock(Date.now());
    const second = component.render(80);
    expect(second.find((line) => strip(line).startsWith(TL))).not.toBe(top);
    for (const line of second) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });
});
