/**
 * Settings → Media fallback — live policy picker + glance (SSOT §9.2).
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
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { showMediaFallbackPicker } from './media';
import { handleModelCommand } from '../model/model';

import type { SlashCommandHost } from '../../hub/dispatch';

export { MEDIA_ANALYZE_TIP, MEDIA_BLOCK_TIP, MEDIA_PATH_TIP };

export function showMediaSettings(host: SlashCommandHost): void {
  const policy = host.state.appState.nonVisionFallbackPolicy ?? 'analyze';
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Media fallback',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
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
            title: 'Media presets',
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
                host.showStatus(`Media preset "${preset.label}" applied.`, 'success');
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
        if (value === 'change-model') {
          void handleModelCommand(host, '');
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Media fallback' },
  );
}

async function showMediaSettingsPanel(host: SlashCommandHost): Promise<void> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const configPath = resolveMediaConfigPath({
    homeDir,
    configPath: host.harness.configPath,
  });

  let policy = host.state.appState.nonVisionFallbackPolicy;
  let configError: string | undefined;
  try {
    const config = await host.harness.getConfig({ reload: true });
    policy = config.media?.nonVisionFallback ?? policy ?? 'analyze';
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }

  const glance = loadMediaSettingsGlance({
    policy,
    model: host.state.appState.model,
    availableModels: host.state.appState.availableModels,
    configPath,
    configError,
  });
  const lines = buildMediaSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Media fallback ',
    enterBeatSeed: 'media-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
