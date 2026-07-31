import { describe, expect, it, vi } from 'vitest';

import { showPersonaSettings } from '#/tui/commands/config/persona/persona-settings';
import {
  buildPersonaSettingsLines,
  formatActivePersonaLine,
} from '#/tui/utils/persona/persona-glance';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makePersonaHost(
  options: {
    persona?: {
      name?: string;
      preset?: string;
      tone?: string;
      personality?: string;
      instructions?: string;
    };
    configError?: boolean;
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  return {
    harness: {
      homeDir: '/home/.superliora',
      configPath: '/home/.superliora/config.toml',
      getConfig: options.configError
        ? vi.fn(async () => {
            throw new Error('config read failed');
          })
        : vi.fn(async () => ({ persona: options.persona })),
    },
    state: {
      transcriptContainer,
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
  } as unknown as SlashCommandHost;
}

describe('persona glance', () => {
  it('formats active persona name from config', () => {
    expect(formatActivePersonaLine({ name: 'Liora' })).toBe('Active persona: Liora');
    expect(formatActivePersonaLine({ preset: 'mentor' })).toBe(
      'Active persona: mentor (preset)',
    );
    expect(formatActivePersonaLine(undefined)).toBe(
      'Active persona: default (engine personality)',
    );
  });

  it('builds tip-heavy panel lines with live config path and fields', () => {
    const lines = buildPersonaSettingsLines({
      configPath: '/home/.superliora/config.toml',
      persona: {
        name: 'Liora',
        preset: 'mentor',
        tone: 'warm',
      },
    });
    const text = lines.join('\n');
    expect(text).toContain('Persona (read-only)');
    expect(text).toContain('Active persona: Liora');
    expect(text).toContain('Preset: mentor');
    expect(text).toContain('/persona set');
    expect(text).toContain('config.toml [persona]');
  });
});

describe('persona settings', () => {
  it('mounts read-only persona panel with live active name', async () => {
    const host = makePersonaHost({ persona: { name: 'Coach', preset: 'mentor' } });
    showPersonaSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Active persona: Coach');
    expect(text).toContain('friendly, professional');
    expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
  });

  it('renders when config load fails', async () => {
    const host = makePersonaHost({ configError: true });
    showPersonaSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('config read failed');
  });
});
