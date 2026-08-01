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
        {
          value: 'tip-analyze',
          label: 'Analyze policy tip',
          description: 'Vision catalog pre-render · injected text before chat model · paste/drop parity.',
        },
        {
          value: 'tip-path',
          label: 'Path note policy tip',
          description: 'Pointer note instead of bytes · vision tool can read attachment later.',
        },
        {
          value: 'tip-block',
          label: 'Block policy tip',
          description: 'Refuse send when image_in/video_in missing · switch model to skip fallback.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
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
        if (value === 'tip-analyze') {
          host.showStatus(MEDIA_ANALYZE_TIP, 'info');
          return;
        }
        if (value === 'tip-path') {
          host.showStatus(MEDIA_PATH_TIP, 'info');
          return;
        }
        if (value === 'tip-block') {
          host.showStatus(MEDIA_BLOCK_TIP, 'info');
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
