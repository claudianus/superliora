import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCustomThemesDir,
  listAvailableThemeEntries,
  listAvailableThemeEntriesSync,
  listCustomThemes,
  listCustomThemesSync,
  loadCustomTheme,
  loadCustomThemeMerged,
  loadCustomThemeMergedSync,
} from '#/tui/theme/custom-theme-loader';
import { darkColors, lightColors } from '#/tui/theme';

let home: string;
const originalHome = process.env['KIMI_CODE_HOME'];

beforeEach(() => {
  home = join(tmpdir(), `kimi-themes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(home, 'themes'), { recursive: true });
  process.env['KIMI_CODE_HOME'] = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env['KIMI_CODE_HOME'];
  } else {
    process.env['KIMI_CODE_HOME'] = originalHome;
  }
});

function writeTheme(name: string, body: unknown): void {
  writeFileSync(join(getCustomThemesDir(), `${name}.json`), JSON.stringify(body), 'utf-8');
}

describe('custom theme loader', () => {
  it('excludes reserved built-in names from the listing', async () => {
    writeTheme('dark', { name: 'dark', colors: {} });
    writeTheme('light', { name: 'light', colors: {} });
    writeTheme('auto', { name: 'auto', colors: {} });
    writeTheme('solarized', { name: 'solarized', colors: { primary: '#268bd2' } });

    expect(await listCustomThemes()).toEqual(['solarized']);
    expect(listCustomThemesSync()).toEqual(['solarized']);
  });

  it('filters invalid hex values without writing to the terminal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      writeTheme('mixed', {
        name: 'mixed',
        colors: { primary: '#268bd2', text: 'not-a-hex', accent: '#ff0000' },
      });

      const loaded = await loadCustomTheme('mixed');
      expect(loaded).toEqual({ primary: '#268bd2', accent: '#ff0000' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns null for a missing theme file', async () => {
    expect(await loadCustomTheme('does-not-exist')).toBeNull();
    expect(await loadCustomThemeMerged('does-not-exist')).toBeNull();
  });

  it('falls back to the dark palette for unspecified tokens by default', async () => {
    writeTheme('solar-dark', { name: 'solar-dark', colors: { primary: '#268bd2' } });
    const merged = await loadCustomThemeMerged('solar-dark');
    expect(merged?.primary).toBe('#268bd2');
    expect(merged?.text).toBe(darkColors.text);
  });

  it('falls back to the light palette when base is "light"', async () => {
    writeTheme('solar-light', {
      name: 'solar-light',
      base: 'light',
      colors: { primary: '#268bd2' },
    });
    const merged = await loadCustomThemeMerged('solar-light');
    expect(merged?.primary).toBe('#268bd2');
    expect(merged?.text).toBe(lightColors.text);
  });

  it('loads merged palettes synchronously for theme previews', () => {
    writeTheme('solar-preview', {
      name: 'solar-preview',
      base: 'light',
      colors: { primary: '#268bd2' },
    });

    const merged = loadCustomThemeMergedSync('solar-preview');
    expect(merged?.primary).toBe('#268bd2');
    expect(merged?.text).toBe(lightColors.text);
  });

  it('accepts v2 skin metadata and expanded color tokens', async () => {
    writeTheme('premium-v2', {
      schemaVersion: 2,
      name: 'premium-v2',
      displayName: 'Premium V2',
      base: 'dark',
      colors: {
        background: '#101820',
        surfaceRaised: '#203040',
        glow: '#33D6C5',
        particle: '#F6C600',
        gradientStart: '#2B9AF3',
        gradientEnd: '#826BDB',
      },
      ansi: {
        foreground: '#F2F4F8',
        background: '#101820',
      },
      effects: { preset: 'premium' },
      layout: { density: 'comfortable' },
      source: { kind: 'file', url: 'example.test/theme' },
    });

    expect(await loadCustomTheme('premium-v2')).toEqual({
      background: '#101820',
      surfaceRaised: '#203040',
      glow: '#33D6C5',
      particle: '#F6C600',
      gradientStart: '#2B9AF3',
      gradientEnd: '#826BDB',
    });
  });

  it('exposes bundled Super Kimi themes without a user themes directory', async () => {
    rmSync(join(home, 'themes'), { recursive: true, force: true });

    expect(await listAvailableThemeEntries()).toContainEqual(
      expect.objectContaining({
        name: 'super-kimi-neon-noir',
        displayName: 'Super Kimi Neon Noir',
        source: 'bundled',
      }),
    );
    expect(listAvailableThemeEntriesSync()).toContainEqual(
      expect.objectContaining({
        name: 'super-kimi-neon-noir',
        displayName: 'Super Kimi Neon Noir',
        source: 'bundled',
        base: 'dark',
      }),
    );
    const bundled = await loadCustomThemeMerged('super-kimi-neon-noir');
    expect(bundled?.primary).toBe('#00D5FF');
  });

  it('exposes generated external terminal themes as bundled themes', async () => {
    rmSync(join(home, 'themes'), { recursive: true, force: true });

    expect(listAvailableThemeEntriesSync()).toContainEqual(
      expect.objectContaining({
        name: 'alacritty-dracula',
        displayName: 'dracula (Alacritty)',
        source: 'bundled-external',
        base: 'dark',
      }),
    );
    const bundled = await loadCustomThemeMerged('tinted-base24-catppuccin-mocha');
    expect(bundled?.background).toBe('#1E1E2E');
    expect(bundled?.syntaxKeyword).toBe('#F5C2E7');
  });

  it('groups external bundled themes by base and removes duplicate palettes', () => {
    rmSync(join(home, 'themes'), { recursive: true, force: true });

    const external = listAvailableThemeEntriesSync().filter(
      (entry) => entry.source === 'bundled-external',
    );
    const firstLightIndex = external.findIndex((entry) => entry.base === 'light');
    const lastDarkIndex = external.findLastIndex((entry) => entry.base === 'dark');

    expect(firstLightIndex).toBeGreaterThan(0);
    expect(lastDarkIndex).toBeGreaterThanOrEqual(0);
    expect(lastDarkIndex).toBeLessThan(firstLightIndex);
    expect(external).toContainEqual(
      expect.objectContaining({ name: 'alacritty-github-dark-colorblind' }),
    );
    expect(external).not.toContainEqual(
      expect.objectContaining({ name: 'alacritty-github-dark-default' }),
    );
  });

  it('lists user themes alongside bundled themes and lets user themes win name collisions', async () => {
    writeTheme('studio', { name: 'studio', colors: { primary: '#268bd2' } });
    writeTheme('super-kimi-neon-noir', {
      name: 'super-kimi-neon-noir',
      colors: { primary: '#123456' },
    });

    const entries = listAvailableThemeEntriesSync();
    expect(entries).toContainEqual(
      expect.objectContaining({ name: 'studio', source: 'custom' }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        name: 'super-kimi-neon-noir',
        source: 'custom',
        overridesBundled: true,
      }),
    );
    expect(entries).not.toContainEqual(
      expect.objectContaining({ name: 'super-kimi-neon-noir', source: 'bundled' }),
    );

    const merged = await loadCustomThemeMerged('super-kimi-neon-noir');
    expect(merged?.primary).toBe('#123456');
  });
});
