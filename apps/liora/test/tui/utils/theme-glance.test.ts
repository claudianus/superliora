import { describe, expect, it } from 'vitest';

import { showThemeSettings } from '#/tui/commands/config/theme-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';
import {
  buildThemeSettingsLines,
  formatThemeCatalogLine,
  loadThemeSettingsGlance,
  resolveLivePaletteKind,
} from '#/tui/utils/theme/theme-glance';
import { vi } from 'vitest';

describe('theme glance', () => {
  it('resolves live palette kind', () => {
    expect(resolveLivePaletteKind(lightColors)).toBe('light');
    expect(resolveLivePaletteKind(darkColors)).toBe('dark');
  });

  it('formats catalog counts', () => {
    const line = formatThemeCatalogLine({
      totalListed: 12,
      bundled: 4,
      custom: 2,
      plugin: 1,
      bundledExternal: 5,
    });
    expect(line).toContain('12 listed');
    expect(line).toContain('4 bundled');
  });

  it('builds tip-heavy panel with live session block', () => {
    const text = buildThemeSettingsLines(
      loadThemeSettingsGlance({
        savedTheme: 'auto',
        palette: lightColors,
        canvasBackgroundEnabled: true,
        configPath: '/home/.superliora/tui.toml',
      }),
    ).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Theme: auto · live palette light (tracking terminal)');
    expect(text).toContain('Catalog:');
    expect(text).toContain('/theme import');
    expect(text).toContain('Settings → Appearance');
  });
});

describe('showThemeSettings', () => {
  it('renders live theme from appState and currentTheme', () => {
    const previousPalette = currentTheme.palette;
    currentTheme.setPalette(darkColors);

    const host = {
      state: {
        appState: { theme: 'dark' },
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as import('#/tui/commands/hub/dispatch').SlashCommandHost;

    showThemeSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Theme: dark · live palette dark');

    currentTheme.setPalette(previousPalette);
  });
});
