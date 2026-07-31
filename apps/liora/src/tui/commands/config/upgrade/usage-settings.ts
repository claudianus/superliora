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

import type { SlashCommandHost } from '../../hub/dispatch';

export { USAGE_CONTEXT_TIP, USAGE_QUOTA_TIP, USAGE_TOKEN_TIP };

export function showUsageSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Usage',
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
          value: 'tip-tokens',
          label: 'Token totals tip',
          description: 'session.getStatus().usage refresh · cache-hit rate · best-effort session $.',
        },
        {
          value: 'tip-quotas',
          label: 'Plan quotas tip',
          description: 'Managed provider quota bars in /usage · Settings → Accounts for plans.',
        },
        {
          value: 'tip-context',
          label: 'Context & reports tip',
          description: 'Footer badge · /usage · /status · Settings → Fleet budget cap.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showUsageSettingsPanel(host);
          return;
        }
        if (value === 'tip-tokens') {
          host.showStatus(USAGE_TOKEN_TIP, 'info');
          return;
        }
        if (value === 'tip-quotas') {
          host.showStatus(USAGE_QUOTA_TIP, 'info');
          return;
        }
        if (value === 'tip-context') {
          host.showStatus(USAGE_CONTEXT_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Usage' },
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
    title: ' Usage ',
    enterBeatSeed: 'usage-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
