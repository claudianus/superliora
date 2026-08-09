import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_FOOTER_PREFERENCES,
  DEFAULT_CONDUCTOR_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  DEFAULT_TUI_THEME,
  DEFAULT_TUI_CONFIG,
  INVALID_TUI_CONFIG_MESSAGE,
  loadTuiConfig,
  parseTuiConfig,
  saveTuiConfig,
  TuiConfigParseError,
} from '#/tui/config';

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = join(tmpdir(), `kimi-tui-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  filePath = join(dir, 'tui.toml');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('TUI config', () => {
  it('creates the default config when the file does not exist', async () => {
    const result = await loadTuiConfig(filePath);

    expect(result).toEqual(DEFAULT_TUI_CONFIG);
    const text = readFileSync(filePath, 'utf-8');
    expect(text).toContain('Client preferences for kimi-code.');
    expect(text).toContain(`theme = "${DEFAULT_TUI_THEME}"`);
    expect(text).toContain('command = ""');
    expect(text).toContain('[upgrade]');
    expect(text).toContain('auto_install = true');
    expect(text).toContain('[appearance]');
    expect(text).toContain('profile = "premium"');
    expect(text).toContain('density = "spacious"');
    expect(text).toContain('particles = "premium"');
    expect(text).toContain('animation_fps = 60');
    expect(text).toContain('canvas_background = true');
    expect(text).toContain('terminal_background = "off"');
    expect(text).toContain('terminal_palette = false');
    expect(text).toContain('show_timestamps = true');
    expect(text).toContain('syntax_theme = "auto"');
    expect(text).toContain('[notifications]');
    expect(text).toContain('enabled = true');
    expect(text).toContain('notification_condition = "unfocused"');
    expect(text).toContain('[onboarding]');
    expect(text).toContain('hub_intro_seen = false');
  });

  it('parses valid TOML', () => {
    const config = parseTuiConfig(`
theme = "light"

[editor]
command = "code --wait"

[notifications]
enabled = false
notification_condition = "always"

[upgrade]
auto_install = false

[appearance]
profile = "premium"
density = "comfortable"
particles = "events"
animation_fps = 18
canvas_background = false
terminal_background = "session"
terminal_palette = true
`);

    expect(config).toEqual({
      theme: 'light',
      locale: 'auto',
      permissionMode: 'yolo',
      disablePasteBurst: false,
      editorCommand: 'code --wait',
      notifications: { enabled: false, condition: 'always' },
      upgrade: { autoInstall: false },
      appearance: {
        profile: 'premium',
        density: 'comfortable',
        particles: 'events',
        animationFps: 18,
        canvasBackground: false,
        terminalBackground: 'session',
        terminalPalette: true,
        showTimestamps: true,
        transcriptDetail: 'standard',
        neat: true,
        syntaxTheme: 'auto',
        missionControl: 'auto',
      },
      footer: DEFAULT_FOOTER_PREFERENCES,
      onboarding: DEFAULT_ONBOARDING_PREFERENCES,
      conductor: DEFAULT_CONDUCTOR_PREFERENCES,
    });
  });

  it('parses onboarding.hub_intro_seen', () => {
    const config = parseTuiConfig(`
[onboarding]
hub_intro_seen = true
`);
    expect(config.onboarding?.hubIntroSeen).toBe(true);
  });

  it('parses onboarding.job_deck_hint_seen', () => {
    const config = parseTuiConfig(`
[onboarding]
job_deck_hint_seen = true
`);
    expect(config.onboarding?.jobDeckHintSeen).toBe(true);
  });

  it('honors an explicit show_timestamps = false', () => {
    const config = parseTuiConfig(`
[appearance]
show_timestamps = false
`);

    expect(config.appearance?.showTimestamps).toBe(false);
  });

  it('defaults showTimestamps when the appearance section omits it', () => {
    const config = parseTuiConfig(`
[appearance]
density = "compact"
`);

    expect(config.appearance?.density).toBe('compact');
    expect(config.appearance?.showTimestamps).toBe(DEFAULT_APPEARANCE_PREFERENCES.showTimestamps);
  });

  it('defaults neat to on and honors an explicit neat = false', () => {
    expect(DEFAULT_APPEARANCE_PREFERENCES.neat).toBe(true);
    expect(parseTuiConfig('[appearance]\ndensity = "compact"\n').appearance?.neat).toBe(true);
    expect(parseTuiConfig('[appearance]\nneat = false\n').appearance?.neat).toBe(false);
  });

  it('keeps a saved theme when appearance has an invalid field', async () => {
    const text = `theme = "superliora-bloodmoon"

[appearance]
show_timestamps = "yes"
density = "compact"
`;
    writeFileSync(filePath, text, 'utf-8');

    const config = await loadTuiConfig(filePath);

    expect(config.theme).toBe('superliora-bloodmoon');
    expect(config.appearance).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(readFileSync(filePath, 'utf-8')).toBe(text);
  });

  it('normalizes an empty editor command to auto-detect', () => {
    const config = parseTuiConfig(`
[editor]
command = "   "
`);

    expect(config).toEqual({
      theme: DEFAULT_TUI_THEME,
      locale: 'auto',
      permissionMode: 'yolo',
      disablePasteBurst: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
      appearance: DEFAULT_APPEARANCE_PREFERENCES,
      footer: DEFAULT_FOOTER_PREFERENCES,
      onboarding: DEFAULT_ONBOARDING_PREFERENCES,
      conductor: DEFAULT_CONDUCTOR_PREFERENCES,
    });
  });

  it('falls back to default notifications when the section is omitted', () => {
    const config = parseTuiConfig(`theme = "dark"`);

    expect(config.notifications).toEqual({ enabled: true, condition: 'unfocused' });
    expect(config.upgrade).toEqual({ autoInstall: true });
    expect(config.appearance).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(config.onboarding).toEqual(DEFAULT_ONBOARDING_PREFERENCES);
  });

  it('throws TuiConfigParseError with fallback when parsing fails, leaving the file untouched', async () => {
    writeFileSync(filePath, '[[[', 'utf-8');

    const error = await loadTuiConfig(filePath).then(
      () => null,
      (error: unknown) => error,
    );

    expect(error).toBeInstanceOf(TuiConfigParseError);
    expect((error as TuiConfigParseError).message).toBe(INVALID_TUI_CONFIG_MESSAGE);
    expect((error as TuiConfigParseError).fallback).toEqual(DEFAULT_TUI_CONFIG);
    expect(readFileSync(filePath, 'utf-8')).toBe('[[[');
  });

  it('salvages theme from unparseable TOML so upgrades do not reset to dark', async () => {
    const broken = '[[[not toml\ntheme = "superliora-bloodmoon"\n';
    writeFileSync(filePath, broken, 'utf-8');

    const error = await loadTuiConfig(filePath).then(
      () => null,
      (error: unknown) => error,
    );

    expect(error).toBeInstanceOf(TuiConfigParseError);
    expect((error as TuiConfigParseError).fallback.theme).toBe('superliora-bloodmoon');
    expect((error as TuiConfigParseError).fallback.appearance).toEqual(
      DEFAULT_APPEARANCE_PREFERENCES,
    );
    expect(readFileSync(filePath, 'utf-8')).toBe(broken);
  });

  it('saves and reloads the normalized config', async () => {
    await saveTuiConfig(
      {
        theme: 'light',
        permissionMode: 'yolo',
        disablePasteBurst: false,
        editorCommand: 'vim',
        notifications: { enabled: false, condition: 'always' },
        upgrade: { autoInstall: false },
        appearance: {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          profile: 'subtle',
          animationFps: 10,
        },
      },
      filePath,
    );

    expect(await loadTuiConfig(filePath)).toEqual({
      theme: 'light',
      locale: 'auto',
      permissionMode: 'yolo',
      disablePasteBurst: false,
      editorCommand: 'vim',
      notifications: { enabled: false, condition: 'always' },
      upgrade: { autoInstall: false },
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle',
        animationFps: 10,
      },
      footer: DEFAULT_FOOTER_PREFERENCES,
      onboarding: DEFAULT_ONBOARDING_PREFERENCES,
      conductor: DEFAULT_CONDUCTOR_PREFERENCES,
    });
  });

  it('round-trips a custom theme through atomic save without losing it', async () => {
    await saveTuiConfig(
      {
        ...DEFAULT_TUI_CONFIG,
        theme: 'superliora-bloodmoon',
      },
      filePath,
    );

    expect((await loadTuiConfig(filePath)).theme).toBe('superliora-bloodmoon');
    expect(readFileSync(filePath, 'utf-8')).toContain('theme = "superliora-bloodmoon"');
  });

  it('defaults missing theme key to Neon Noir, not built-in dark', () => {
    expect(DEFAULT_TUI_THEME).toBe('superliora-neon-noir');
    expect(DEFAULT_TUI_CONFIG.theme).toBe('superliora-neon-noir');
    expect(parseTuiConfig('permission_mode = "yolo"\n').theme).toBe('superliora-neon-noir');
    expect(parseTuiConfig('').theme).toBe('superliora-neon-noir');
  });

  it('preserves an explicit dark choice through save/load (not forced off dark)', async () => {
    await saveTuiConfig({ ...DEFAULT_TUI_CONFIG, theme: 'dark' }, filePath);
    expect((await loadTuiConfig(filePath)).theme).toBe('dark');
    expect(readFileSync(filePath, 'utf-8')).toContain('theme = "dark"');
  });

  it('does not rewrite a saved non-default theme when reloading defaults merge', async () => {
    const text = `theme = "superliora-ash"\n\n[upgrade]\nauto_install = false\n`;
    writeFileSync(filePath, text, 'utf-8');
    const loaded = await loadTuiConfig(filePath);
    expect(loaded.theme).toBe('superliora-ash');
    expect(loaded.upgrade.autoInstall).toBe(false);
    // On-disk preference must stay until an explicit save rewrites it.
    expect(readFileSync(filePath, 'utf-8')).toBe(text);
  });

  it('escapes special characters in a custom theme name so the TOML round-trips', async () => {
    const theme = 'weird"name\\with-quote';
    await saveTuiConfig(
      {
        theme,
        permissionMode: 'yolo',
        disablePasteBurst: false,
        editorCommand: null,
        notifications: DEFAULT_TUI_CONFIG.notifications,
        upgrade: DEFAULT_TUI_CONFIG.upgrade,
        appearance: DEFAULT_TUI_CONFIG.appearance,
      },
      filePath,
    );

    expect((await loadTuiConfig(filePath)).theme).toBe(theme);
  });
});
