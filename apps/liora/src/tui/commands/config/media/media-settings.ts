/**
 * Settings → Media fallback — live policy picker + glance (SSOT §9.2).
 * Also hosts the per-kind analyzer model overrides (`[media.analyzer_models]`).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { getDataDir } from '#/utils/paths';
import {
  buildMediaSettingsLines,
  loadMediaSettingsGlance,
  MEDIA_ANALYZE_TIP,
  MEDIA_BLOCK_TIP,
  MEDIA_PATH_TIP,
  resolveMediaConfigPath,
} from '#/tui/utils/media/media-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { MEDIA_PRESETS } from '#/tui/utils/settings/media-presets';
import { settingsPresetsRow, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { showMediaFallbackPicker } from './media';
import { handleModelCommand } from '../model/model';

import type { MediaAnalyzerModelsConfig } from '@superliora/sdk';
import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { MEDIA_ANALYZE_TIP, MEDIA_BLOCK_TIP, MEDIA_PATH_TIP };

/** Picker rows for one media kind's analyzer override. */
const ANALYZER_KINDS: readonly {
  readonly kind: keyof MediaAnalyzerModelsConfig;
  readonly label: string;
  readonly capability: string;
}[] = [
  { kind: 'image', label: 'Image analyzer', capability: 'image_in' },
  { kind: 'video', label: 'Video analyzer', capability: 'video_in' },
  { kind: 'audio', label: 'Audio analyzer', capability: 'audio_in' },
  { kind: 'pdf', label: 'PDF analyzer', capability: 'pdf_in' },
];

const AUTO_ANALYZER = '__auto__';

function overrideLabel(alias: string | undefined): string {
  const trimmed = alias?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : 'Auto';
}

export function showMediaSettings(host: SlashCommandHost): void {
  const policy = host.state.appState.nonVisionFallbackPolicy ?? 'analyze';
  const overrides = host.state.appState.mediaAnalyzerModels;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.media.title'),
      searchable: true,
      options: [
        settingsPresetsRow(),
        {
          value: 'status',
          label: 'Media fallback status',
          description:
            'Live nonVisionFallback policy · current model image_in/video_in · effective send posture.',
        },
        {
          value: 'change-policy',
          label: `Change policy · ${policy}`,
          description: 'analyze | path | block — when the chat model is text-only.',
        },
        ...ANALYZER_KINDS.map(({ kind, label }) => ({
          value: `analyzer-${kind}`,
          label: `${label} · ${overrideLabel(overrides?.[kind])}`,
          description:
            'Model used to render this media kind when the chat model cannot read it. Auto picks a capable catalog model.',
        })),
        {
          value: 'change-model',
          label: 'Change model…',
          description: 'Switch to a vision-capable model to skip fallback.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: ttui('tui.settings.pane.media.presets'),
            catalog: MEDIA_PRESETS,
            currentId: policy,
            onApply: async (preset) => {
              try {
                await host.harness.setConfig({
                  media: { nonVisionFallback: preset.patch.nonVisionFallback },
                });
                host.setAppState({
                  nonVisionFallbackPolicy: preset.patch.nonVisionFallback,
                });
                host.showStatus(ttui('tui.media.presetApplied', { label: preset.label }), 'success');
              } catch (error) {
                host.showError(
                  `Failed to apply media preset: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            },
          });
          return;
        }
        if (value === 'status') {
          void showMediaSettingsPanel(host);
          return;
        }
        if (value === 'change-policy') {
          showMediaFallbackPicker(host);
          return;
        }
        if (value.startsWith('analyzer-')) {
          const kind = value.slice('analyzer-'.length);
          const entry = ANALYZER_KINDS.find((row) => row.kind === kind);
          if (entry !== undefined) {
            showAnalyzerModelPicker(host, entry);
          }
          return;
        }
        if (value === 'change-model') {
          void handleModelCommand(host, '');
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.media.title') },
  );
}

/**
 * Per-kind analyzer override picker: auto (clear) plus every configured
 * model alias whose declared capabilities include the kind. Writes through
 * `setConfig` and refreshes the cached appState so the pane re-renders.
 */
function showAnalyzerModelPicker(
  host: SlashCommandHost,
  entry: (typeof ANALYZER_KINDS)[number],
): void {
  const overrides = host.state.appState.mediaAnalyzerModels;
  const current = overrides?.[entry.kind]?.trim();
  const mark = (value: string, label: string): string =>
    value === current ? `${label} ✓` : label;

  const candidates = Object.entries(host.state.appState.availableModels)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .filter(([, alias]) => alias.capabilities?.includes(entry.capability) === true)
    .map(([alias, aliasEntry]) => ({
      value: alias,
      label: mark(alias, alias),
      description: aliasEntry.provider,
    }));

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: `${entry.label} — pick a model`,
      searchable: true,
      options: [
        {
          value: AUTO_ANALYZER,
          label: mark(AUTO_ANALYZER, 'Auto (clear override)'),
          description:
            'Deterministic catalog selection: current model first, then same provider, then the first capable model.',
        },
        ...candidates,
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyAnalyzerOverride(host, entry, value === AUTO_ANALYZER ? '' : value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}

async function applyAnalyzerOverride(
  host: SlashCommandHost,
  entry: (typeof ANALYZER_KINDS)[number],
  alias: string,
): Promise<void> {
  try {
    await host.harness.setConfig({
      media: { analyzerModels: { [entry.kind]: alias } },
    });
    host.setAppState({
      mediaAnalyzerModels: {
        ...host.state.appState.mediaAnalyzerModels,
        [entry.kind]: alias,
      },
    });
    const summary = alias.length > 0 ? alias : 'Auto';
    host.showStatus(`${entry.label} set to ${summary}`, 'success');
  } catch (error) {
    host.showError(
      `Failed to set ${entry.label.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function showMediaSettingsPanel(host: SlashCommandHost): Promise<void> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const configPath = resolveMediaConfigPath({
    homeDir,
    configPath: host.harness.configPath,
  });

  let policy = host.state.appState.nonVisionFallbackPolicy;
  let analyzerModels: MediaAnalyzerModelsConfig | undefined;
  let configError: string | undefined;
  try {
    const config = await host.harness.getConfig({ reload: true });
    policy = config.media?.nonVisionFallback ?? policy ?? 'analyze';
    analyzerModels = config.media?.analyzerModels;
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }

  const glance = loadMediaSettingsGlance({
    policy,
    model: host.state.appState.model,
    availableModels: host.state.appState.availableModels,
    analyzerModels,
    configPath,
    configError,
  });
  const lines = buildMediaSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.media.panelTitle'),
    enterBeatSeed: 'media-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
