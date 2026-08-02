import type { ExperimentalFeatureState } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  EXPERIMENTS_CODEGRAPH_TIP,
  EXPERIMENTS_FEATURE_FLAGS_TIP,
  showExperimentsSettings,
} from '#/tui/commands/config/experiments/experiments-settings';
import {
  buildExperimentsSettingsLines,
  formatExperimentsLiveLine,
  summarizeExperimentalFeatures,
} from '#/tui/utils/experiments/experiments-glance';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function feature(
  overrides: Partial<ExperimentalFeatureState> = {},
): ExperimentalFeatureState {
  return {
    id: 'async_compaction',
    title: 'Async background compaction',
    description: 'Background full compaction.',
    surface: 'core',
    env: 'SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION',
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
      centerModalStack: [] as readonly unknown[],
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectExperimentsAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
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

});

describe('showExperimentsSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeExperimentsHost();
    showExperimentsSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('mounts read-only experiments panel with live config flags', async () => {
    const host = makeExperimentsHost();
    showExperimentsSettings(host);
    selectExperimentsAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Live flags:');
    expect(text).toContain('async_compaction ON (config)');
    expect(text).toContain('prompt_intelligence OFF (config)');
    expect(host.harness.getExperimentalFeatures).toHaveBeenCalled();
  });

  it('renders when feature load fails', async () => {
    const host = makeExperimentsHost({ loadError: true });
    showExperimentsSettings(host);
    selectExperimentsAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('rpc unavailable');
  });
});
