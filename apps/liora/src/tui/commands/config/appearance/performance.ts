/**
 * /performance slash command and Settings → Appearance → Performance picker.
 * Persists `tui.toml` `performance_mode` without rewriting `[appearance]`.
 * Overlay is resolved at render time from stored appearance + mode.
 */

import {
  DEFAULT_PERFORMANCE_MODE,
  saveTuiConfig,
  type PerformanceMode,
} from '../../../config';
import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { formatErrorMessage } from '../../../utils/event-payload';
import { ttui } from '../../../utils/tui-i18n';
import { requestTUIContentRender } from '../../../utils/render/frame-render';
import { currentAppearance, tuiConfigFromHost } from './tui-persist';
import { resolvePerformanceOverlay } from '../../../features/appearance/performance-mode';
import type { SlashCommandHost } from '../../hub/dispatch';

const PERFORMANCE_VALUES = ['off', 'auto', 'on'] as const;

function isPerformanceMode(value: string): value is PerformanceMode {
  return (PERFORMANCE_VALUES as readonly string[]).includes(value);
}

export function currentPerformanceMode(host: SlashCommandHost): PerformanceMode {
  return host.state.appState.performanceMode ?? DEFAULT_PERFORMANCE_MODE;
}

/**
 * Persist mode, update appState, and re-apply effective appearance
 * (transcript density + motion) so turning the overlay off restores
 * stored prefs without mutating `[appearance]` on disk.
 */
export async function persistPerformanceMode(
  host: SlashCommandHost,
  mode: PerformanceMode,
): Promise<boolean> {
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { performanceMode: mode }));
  } catch (error) {
    host.showStatus(
      ttui('tui.performance.saveFailed', { message: formatErrorMessage(error) }),
      'error',
    );
    return false;
  }

  host.setAppState({ performanceMode: mode });
  const stored = currentAppearance(host);
  const overlay = resolvePerformanceOverlay(mode, stored);
  host.setTranscriptDetail(overlay.effectiveAppearance.transcriptDetail);
  // AppearanceController re-applies via setAppState only when `appearance` is
  // in the patch; force a content render so motion/transcript re-read mode.
  requestTUIContentRender(host.state);
  return true;
}

export async function handlePerformanceCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const token = args.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (token.length === 0 || token === 'help') {
    showPerformanceSettings(host);
    return;
  }
  if (!isPerformanceMode(token)) {
    host.showError(ttui('tui.performance.usage'));
    return;
  }
  if (token === currentPerformanceMode(host)) {
    host.showStatus(ttui('tui.performance.unchanged', { value: token }));
    return;
  }
  const ok = await persistPerformanceMode(host, token);
  if (ok) {
    host.showStatus(
      ttui('tui.performance.applied', { value: labelForMode(token) }),
      'success',
    );
  }
}

function labelForMode(mode: PerformanceMode): string {
  if (mode === 'auto') return ttui('tui.performance.option.auto');
  if (mode === 'on') return ttui('tui.performance.option.on');
  return ttui('tui.performance.option.off');
}

export function showPerformanceSettings(host: SlashCommandHost): void {
  const current = currentPerformanceMode(host);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.performance.title'),
      hint: ttui('tui.performance.hint'),
      currentValue: current,
      options: [
        {
          value: 'off',
          label: ttui('tui.performance.option.off'),
          description: ttui('tui.performance.option.offDesc'),
        },
        {
          value: 'auto',
          label: ttui('tui.performance.option.auto'),
          description: ttui('tui.performance.option.autoDesc'),
        },
        {
          value: 'on',
          label: ttui('tui.performance.option.on'),
          description: ttui('tui.performance.option.onDesc'),
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (!isPerformanceMode(value)) return;
        void persistPerformanceMode(host, value).then((ok) => {
          if (ok) {
            host.showStatus(
              ttui('tui.performance.applied', { value: labelForMode(value) }),
              'success',
            );
          }
        });
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.performance.title') },
  );
}
