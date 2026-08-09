/**
 * Settings → Visual Quality — live motion budget + real PQ / density actions.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import {
  buildPremiumSettingsLines,
  loadPremiumVisualGlance,
  PREMIUM_DENSITY_TIP,
  PREMIUM_MOTION_TIP,
  PREMIUM_PQ_TIP,
} from '#/tui/utils/premium/premium-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { PREMIUM_PRESETS } from '#/tui/utils/settings/premium-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { applyPremiumQuality } from '../../premium';
import {
  showAppearanceSettings,
  showTranscriptDetailPicker,
} from '../appearance/appearance-settings';
import { currentAppearance } from '../appearance/tui-persist';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { PREMIUM_DENSITY_TIP, PREMIUM_MOTION_TIP, PREMIUM_PQ_TIP };

export function showPremiumSettings(host: SlashCommandHost): void {
  const pqOn = host.state.appState.premiumQualityMode === true;
  const appearance = currentAppearance(host);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.premium.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
        {
          value: 'status',
          label: 'Visual Quality status',
          description:
            'Harness PQ toggle · live motion budget · render quality · frame health.',
        },
        {
          value: 'pq-on',
          label: pqOn ? 'Visual Quality ON (current)' : 'Turn Visual Quality ON',
          description: 'Harness art direction + anti-slop visuals · requires session.',
        },
        {
          value: 'pq-off',
          label: !pqOn ? 'Visual Quality OFF (current)' : 'Turn Visual Quality OFF',
          description: 'Disable harness PQ mode for this session.',
        },
        {
          value: 'transcript-detail',
          label: `Transcript detail · ${appearance.transcriptDetail}`,
          description: 'minimal | compact | standard | full — live tool-card density.',
        },
        {
          value: 'appearance',
          label: 'Appearance prefs…',
          description: 'Motion profile · particles · FPS · layout density pickers.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: ttui('tui.settings.pane.premium.presets'),
            catalog: PREMIUM_PRESETS,
            currentId: pqOn ? 'on' : 'off',
            onApply: async (preset) => {
              await applyPremiumQuality(host, preset.patch.premiumQuality);
            },
          });
          return;
        }
        if (value === 'status') {
          void showPremiumSettingsPanel(host);
          return;
        }
        if (value === 'pq-on') {
          void applyPremiumQuality(host, true);
          return;
        }
        if (value === 'pq-off') {
          void applyPremiumQuality(host, false);
          return;
        }
        if (value === 'transcript-detail') {
          showTranscriptDetailPicker(host);
          return;
        }
        if (value === 'appearance') {
          showAppearanceSettings(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.premium.title') },
  );
}

async function showPremiumSettingsPanel(host: SlashCommandHost): Promise<void> {
  let sessionPremiumQuality: boolean | undefined;
  try {
    const status = await host.requireSession().getStatus();
    if (status.premiumQualityMode !== undefined) {
      sessionPremiumQuality = status.premiumQualityMode;
    }
  } catch {
    /* panel still renders from appState + renderer */
  }

  const glance = loadPremiumVisualGlance({
    premiumQualityMode: host.state.appState.premiumQualityMode,
    appearance: currentAppearance(host),
    renderQuality: getAppearanceRenderQuality(),
    renderHealth: getAppearanceRenderHealth(),
    diagnostics: host.state.renderer.nativeRuntime?.diagnostics,
    sessionPremiumQuality,
  });
  const lines = buildPremiumSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.premium.panelTitle'),
    enterBeatSeed: 'premium-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
