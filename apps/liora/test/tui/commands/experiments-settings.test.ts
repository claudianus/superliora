import type { ExperimentalFeatureState } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import { showExperimentsSettings } from '#/tui/commands/config/experiments-settings';
import {
  buildExperimentsSettingsLines,
  formatExperimentsLiveLine,
  summarizeExperimentalFeatures,
} from '#/tui/utils/experiments/experiments-glance';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function feature(
  overrides: Partial<ExperimentalFeatureState> = {},
): ExperimentalFeatureState {
  return {
    id: 'micro_compaction',
    title: 'Micro compaction',
    description: 'Trim older tool results.',
    surface: 'core',
    env: 'SUPERLIORA_EXPERIMENTAL_MICRO_COMPACTION',
    defaultEnabled: true,
    enabled: true,
    source: 'default',
    ...overrides,
  };
}

function makeExperimentsHost(
  options: {
    features?: ExperimentalFeatureState[];
    loadError?: boolean;
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  const features = options.features ?? [
    feature({ enabled: true, source: 'config', configValue: true }),
    feature({
      id: 'prompt_intelligence',
      title: 'Prompt intelligence',
      enabled: false,
      source: 'config',
      configValue: false,
    }),
  ];
  return {
    harness: {
      getExperimentalFeatures: options.loadError
        ? vi.fn(async () => {
            throw new Error('rpc unavailable');
          })
        : vi.fn(async () => features),
    },
    state: {
      transcriptContainer,
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
  } as unknown as SlashCommandHost;
}

describe('experiments glance', () => {
  it('summarizes live flags from config', () => {
    const summary = summarizeExperimentalFeatures([
      feature({ enabled: true, source: 'config', configValue: true }),
      feature({ id: 'auto_dream', enabled: false, source: 'env' }),
    ]);
    expect(summary).toEqual({
      totalCount: 2,
      enabledCount: 1,
      disabledCount: 1,
      configOverrideCount: 1,
      envOverrideCount: 1,
    });
    expect(formatExperimentsLiveLine([
      feature({ enabled: true, source: 'config', configValue: true }),
      feature({ id: 'auto_dream', enabled: false, source: 'env' }),
    ])).toContain('1 ON · 1 OFF · 2 registered · 1 config override');
  });

  it('builds tip-heavy panel with per-flag lines', () => {
    const text = buildExperimentsSettingsLines({
      features: [
        feature({ enabled: true, source: 'config', configValue: true }),
        feature({
          id: 'prompt_intelligence',
          title: 'Prompt intelligence',
          enabled: false,
          source: 'config',
          configValue: false,
        }),
      ],
    }).join('\n');
    expect(text).toContain('Experiments (read-only)');
    expect(text).toContain('micro_compaction ON (config)');
    expect(text).toContain('prompt_intelligence OFF (config)');
    expect(text).toContain('Harness → Experiments');
    expect(text).toContain('SUPERLIORA_EXPERIMENTAL_FLAG');
  });
});

describe('experiments settings', () => {
  it('mounts read-only experiments panel with live config flags', async () => {
    const host = makeExperimentsHost();
    showExperimentsSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Live flags:');
    expect(text).toContain('micro_compaction ON (config)');
    expect(text).toContain('prompt_intelligence OFF (config)');
    expect(host.harness.getExperimentalFeatures).toHaveBeenCalled();
  });

  it('renders when feature load fails', async () => {
    const host = makeExperimentsHost({ loadError: true });
    showExperimentsSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('rpc unavailable');
  });
});
