import { visibleWidth } from '#/tui/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatClockTime, UserMessageComponent } from '#/tui/components/messages/user-message';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/utils/appearance-effects';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('UserMessageComponent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders video placeholders as plain text, not inline image escapes', () => {
    stubTerminalImageProtocol('none');

    const component = new UserMessageComponent(
      'please inspect [video #1 sample.mov]',
      [],
    );

    const out = stripAnsi(component.render(80).join('\n'));

    expect(out).toContain('[video #1 sample.mov]');
    expect(out).not.toContain('\u001B_G');
    expect(out).not.toContain('\u001B]1337;File=');
  });

  it('keeps user lines within very narrow widths', () => {
    stubTerminalImageProtocol('none');

    const component = new UserMessageComponent('please inspect the attached output', []);

    for (const width of [1, 2, 4, 10, 39]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('reuses rendered line arrays at the same width until invalidated', () => {
    stubTerminalImageProtocol('none');

    const component = new UserMessageComponent('hello', []);
    const first = component.render(80);
    const second = component.render(80);

    expect(second).toBe(first);

    component.invalidate();
    expect(component.render(80)).not.toBe(first);
  });

  it('shows the full image marker when the attachment is undecodable', () => {
    stubTerminalImageProtocol('kitty');

    // Signature + IHDR only: no IDAT chunk, so the decoder must reject the
    // attachment and the component must fall back to the placeholder marker.
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrLength = new Uint8Array([0x00, 0x00, 0x00, 0x0d]);
    const ihdrType = new Uint8Array([0x49, 0x48, 0x44, 0x52]);
    const widthBytes = new Uint8Array([
      (2000 >> 24) & 0xff,
      (2000 >> 16) & 0xff,
      (2000 >> 8) & 0xff,
      2000 & 0xff,
    ]);
    const heightBytes = new Uint8Array([
      (1302 >> 24) & 0xff,
      (1302 >> 16) & 0xff,
      (1302 >> 8) & 0xff,
      1302 & 0xff,
    ]);
    const rest = new Uint8Array([0x08, 0x02, 0x00, 0x00, 0x00]);
    const bytes = new Uint8Array([
      ...pngSignature,
      ...ihdrLength,
      ...ihdrType,
      ...widthBytes,
      ...heightBytes,
      ...rest,
    ]);

    const attachment: ImageAttachment = {
      id: 1,
      kind: 'image',
      bytes,
      mime: 'image/png',
      width: 2000,
      height: 1302,
      placeholder: '[image #1 (2000×1302)]',
    };

    const component = new UserMessageComponent('', [attachment]);
    const lines = component.render(80);

    const markerLine = lines.find((l) => l.includes('[image #1 (2000×1302)]'));
    expect(markerLine).toBeDefined();
    expect(markerLine).not.toContain('…');
    // Raw Kitty escapes must never reach the transcript: the cell compositor
    // only understands SGR/OSC-8 and would render the payload as garbage.
    expect(lines.join('')).not.toContain('\u001B_G');
  });

  it('omits the sparkles bullet when an empty bullet is provided', () => {
    stubTerminalImageProtocol('none');

    const withBullet = stripAnsi(new UserMessageComponent('hello', []).render(80).join('\n'));
    expect(withBullet).toContain('✨');
    expect(withBullet).toContain('hello');

    const lines = new UserMessageComponent('$ ls', [], '').render(80).map(stripAnsi);
    const contentLine = lines.find((l) => l.includes('$ ls'));
    expect(contentLine).toBeDefined();
    expect(stripAnsi(lines.join('\n'))).not.toContain('✨');
    // The `$` sits at the leading column where the bullet used to be.
    expect(contentLine?.startsWith('$ ls')).toBe(true);
  });

  describe('timestamps', () => {
    // 2023-11-14T22:13:20Z — the local HH:MM varies by timezone, so every
    // assertion compares against formatClockTime(fixedMs), not a literal.
    const fixedMs = 1_700_000_000_000;

    afterEach(() => {
      setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    });

    it('shows the HH:MM marker after the bullet when showTimestamps is on', () => {
      stubTerminalImageProtocol('none');
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        showTimestamps: true,
      });

      const component = new UserMessageComponent('hello', [], undefined, fixedMs);
      const out = stripAnsi(component.render(80).join('\n'));

      const clock = formatClockTime(fixedMs);
      expect(clock).toMatch(/^\d{2}:\d{2}$/);
      expect(out).toContain(`✨ ${clock} hello`);
    });

    it('omits the marker when showTimestamps is off', () => {
      stubTerminalImageProtocol('none');
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        showTimestamps: false,
      });

      const component = new UserMessageComponent('hello', [], undefined, fixedMs);
      const out = stripAnsi(component.render(80).join('\n'));

      expect(out).not.toContain(formatClockTime(fixedMs));
      expect(out).toContain('✨ hello');
    });

    it('renders exactly as before when no timestamp is provided', () => {
      stubTerminalImageProtocol('none');
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        showTimestamps: true,
      });

      const plain = new UserMessageComponent('hello', []).render(80);
      const explicit = new UserMessageComponent('hello', [], undefined, undefined).render(80);

      expect(explicit).toEqual(plain);
      expect(stripAnsi(plain.join('\n'))).toContain('✨ hello');
    });

    it('repaints cached lines when the preference toggles', () => {
      stubTerminalImageProtocol('none');
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        showTimestamps: true,
      });

      const component = new UserMessageComponent('hello', [], undefined, fixedMs);
      const before = stripAnsi(component.render(80).join('\n'));
      expect(before).toContain(formatClockTime(fixedMs));

      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        showTimestamps: false,
      });
      const after = stripAnsi(component.render(80).join('\n'));
      expect(after).not.toContain(formatClockTime(fixedMs));
    });
  });
});

describe('formatClockTime', () => {
  it('formats epoch milliseconds as zero-padded 24-hour local HH:MM', () => {
    const ms = 1_700_000_000_000;
    const date = new Date(ms);
    const expected = `${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;

    const result = formatClockTime(ms);

    expect(result).toBe(expected);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('zero-pads single-digit hours and minutes', () => {
    const date = new Date();
    date.setHours(3, 5, 0, 0);

    expect(formatClockTime(date.getTime())).toBe('03:05');
  });
});

function stubTerminalImageProtocol(protocol: 'kitty' | 'none'): void {
  vi.stubEnv('TERM', protocol === 'kitty' ? 'xterm-kitty' : 'xterm-256color');
  vi.stubEnv('TERM_PROGRAM', '');
  vi.stubEnv('KITTY_WINDOW_ID', protocol === 'kitty' ? '1' : '');
  vi.stubEnv('WEZTERM_PANE', '');
  vi.stubEnv('GHOSTTY_RESOURCES_DIR', '');
  vi.stubEnv('TMUX', '');
  vi.stubEnv('ZELLIJ', '');
  vi.stubEnv('CI', '');
}
