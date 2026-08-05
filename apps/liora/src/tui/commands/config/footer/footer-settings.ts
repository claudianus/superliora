/**
 * Settings → Status bar — customize every footer slot, pulse, and label style.
 */

import {
  DEFAULT_FOOTER_PREFERENCES,
  saveTuiConfig,
  type FooterPreferences,
  type FooterSlot,
} from '#/tui/config';
import { formatErrorMessage } from '#/tui/utils/event-payload';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '#/tui/utils/ui/mount-picker';
import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import {
  cycleFooterLabels,
  cycleFooterSlot,
  FOOTER_SETTINGS_SLOTS,
  formatSlotModeLabel,
  type FooterSettingsKey,
} from '../../../components/chrome/footer/footer-preferences';
import type { SlashCommandHost } from '../../hub/dispatch';
import { currentFooter, tuiConfigFromHost } from '../appearance/tui-persist';
import { FOOTER_PRESETS } from '#/tui/utils/settings/footer-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';

export const FOOTER_STATUS_TIP =
  'Status bar: Settings → Status bar · tui.toml [footer] · labels plain|compact · slots auto|always|off.';

export function showFooterSettings(host: SlashCommandHost): void {
  openFooterSettingsPicker(host);
}

function openFooterSettingsPicker(host: SlashCommandHost): void {
  const footer = currentFooter(host);
  const options = [
    SETTINGS_PRESETS_ROW,
    {
      value: 'status',
      label: 'Status bar overview',
      description: buildFooterOverview(footer),
    },
    ...FOOTER_SETTINGS_SLOTS.map((row) => {
      const value = footer[row.key];
      const status =
        row.kind === 'labels'
          ? String(value)
          : row.kind === 'slot'
            ? formatSlotModeLabel(value as FooterSlot)
            : value
              ? 'On'
              : 'Off';
      return {
        value: row.key,
        label: `${row.label}  ·  ${status}`,
        description: row.tip,
      };
    }),
    {
      value: 'reset',
      label: 'Reset to layered defaults',
      description: 'Plain labels · essentials auto · index off · pulses on.',
    },
    {
      value: 'tip',
      label: 'Status bar tip',
      description: FOOTER_STATUS_TIP,
    },
  ];

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Status bar',
      hint: '↑↓ · Enter cycle · Esc',
      searchable: true,
      options,
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: 'Status bar presets',
            catalog: FOOTER_PRESETS,
            onApply: async (preset) => {
              await persistFooter(host, { ...preset.patch }, `Status bar preset "${preset.label}" applied.`);
            },
          });
          return;
        }
        if (value === 'status') {
          host.showStatus(buildFooterOverview(currentFooter(host)), 'info');
          return;
        }
        if (value === 'tip') {
          host.showStatus(FOOTER_STATUS_TIP, 'info');
          return;
        }
        if (value === 'reset') {
          void persistFooter(host, { ...DEFAULT_FOOTER_PREFERENCES }, 'Reset status bar to defaults.');
          return;
        }
        void cycleFooterKey(host, value as FooterSettingsKey);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Status bar' },
  );
}

async function cycleFooterKey(host: SlashCommandHost, key: FooterSettingsKey): Promise<void> {
  const prev = currentFooter(host);
  let next: FooterPreferences = { ...prev };
  const row = FOOTER_SETTINGS_SLOTS.find((r) => r.key === key);
  if (row === undefined) return;

  if (row.kind === 'labels') {
    next = { ...next, labels: cycleFooterLabels(prev.labels) };
  } else if (row.kind === 'slot') {
    const current = prev[key];
    if (typeof current === 'string' && current !== 'plain' && current !== 'compact') {
      next = { ...next, [key]: cycleFooterSlot(current as FooterSlot) };
    }
  } else {
    const current = prev[key];
    if (typeof current === 'boolean') {
      next = { ...next, [key]: !current };
    }
  }

  const value = next[key];
  const status =
    row.kind === 'labels'
      ? String(value)
      : row.kind === 'slot'
        ? formatSlotModeLabel(value as FooterSlot)
        : value
          ? 'On'
          : 'Off';
  await persistFooter(host, next, `${row.label} → ${status}`);
  // Re-open picker so operators can keep cycling without re-entering Settings.
  openFooterSettingsPicker(host);
}

async function persistFooter(
  host: SlashCommandHost,
  footer: FooterPreferences,
  message: string,
): Promise<void> {
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { footer }));
  } catch (error) {
    host.showStatus(`Failed to save status bar: ${formatErrorMessage(error)}`, 'error');
    return;
  }
  host.setAppState({ footer });
  requestTUILayoutRender(host.state);
  host.showStatus(message, 'success');
}

function buildFooterOverview(footer: FooterPreferences): string {
  return [
    `Labels: ${footer.labels}`,
    `Core: modes ${footer.modes} · model ${footer.model} · path ${footer.cwd} · git ${footer.git}`,
    `Context ${footer.context} · goal ${footer.goal} · menu ${footer.menu} · bg ${footer.background}`,
    `Soft: tips ${footer.tips} · next ${footer.nextAction} · ws ${footer.workingSet} · quota ${footer.quota}`,
    `Ops: media ${footer.mediaReady} · index ${footer.index} · mcp ${footer.mcp} · cache ${footer.cache}`,
  ].join(' · ');
}
