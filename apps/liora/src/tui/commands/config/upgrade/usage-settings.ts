/**
 * Settings → Usage — live token/$ glance from getStatus (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { formatErrorMessage } from '../../../utils/event-payload';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildUsageSettingsLines,
  loadUsageSettingsGlance,
  USAGE_CONTEXT_TIP,
  USAGE_QUOTA_TIP,
  USAGE_TOKEN_TIP,
} from '#/tui/utils/usage/usage-settings-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { showQuota } from '../../info/info';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { USAGE_CONTEXT_TIP, USAGE_QUOTA_TIP, USAGE_TOKEN_TIP };

export function showUsageSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.usage.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Usage status',
          description:
            'Live token/$ from getStatus · context window · session cost · fleet budget cap.',
        },
        {
          value: 'quota',
          label: 'Quota',
          description: 'Live provider subscription quotas and API credits (/quota).',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showUsageSettingsPanel(host);
          return;
        }
        if (value === 'quota') {
          void showQuota(host);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.usage.title') },
  );
}

async function showUsageSettingsPanel(host: SlashCommandHost): Promise<void> {
  let glance = loadUsageSettingsGlance({
    sessionCostUsd: host.state.appState.sessionCostUsd,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
  });

  try {
    const status = await host.requireSession().getStatus();
    glance = loadUsageSettingsGlance({
      status,
      sessionCostUsd: host.state.appState.sessionCostUsd,
      contextUsage: host.state.appState.contextUsage,
      contextTokens: host.state.appState.contextTokens,
      maxContextTokens: host.state.appState.maxContextTokens,
    });
  } catch (error) {
    glance = loadUsageSettingsGlance({
      sessionCostUsd: host.state.appState.sessionCostUsd,
      contextUsage: host.state.appState.contextUsage,
      contextTokens: host.state.appState.contextTokens,
      maxContextTokens: host.state.appState.maxContextTokens,
      sessionError: formatErrorMessage(error),
    });
  }

  const lines = buildUsageSettingsLines(glance);
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.usage.panelTitle'),
    enterBeatSeed: 'usage-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
