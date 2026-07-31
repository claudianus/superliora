/**
 * Settings → Visual Quality — live motion budget + renderer quality glance (SSOT §9.2).
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
import { currentAppearance } from '../appearance/tui-persist';

import type { SlashCommandHost } from '../../hub/dispatch';

export { PREMIUM_DENSITY_TIP, PREMIUM_MOTION_TIP, PREMIUM_PQ_TIP };

export function showPremiumSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Visual Quality',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Visual Quality status',
          description:
            'Harness PQ toggle · live motion budget · render quality · frame health.',
        },
        {
          value: 'tip-motion',
          label: 'Motion profile tip',
          description:
            'profile · particles · animation-fps · shared animation clock · /appearance.',
        },
        {
          value: 'tip-density',
          label: 'Density tip',
          description:
            'appearance density · transcript-detail · /transcript · tui.toml [appearance].',
        },
        {
          value: 'tip-pq',
          label: 'Visual Quality (PQ) tip',
          description:
            'Harness anti-slop toggle · /premium on|off · session RPC · not task quality.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showPremiumSettingsPanel(host);
          return;
        }
        if (value === 'tip-motion') {
          host.showStatus(PREMIUM_MOTION_TIP, 'info');
          return;
        }
        if (value === 'tip-density') {
          host.showStatus(PREMIUM_DENSITY_TIP, 'info');
          return;
        }
        if (value === 'tip-pq') {
          host.showStatus(PREMIUM_PQ_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Visual Quality' },
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
    title: ' Visual Quality ',
    enterBeatSeed: 'premium-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
