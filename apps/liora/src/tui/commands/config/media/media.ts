import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { formatErrorMessage } from '../../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

/**
 * Settings → Media fallback: policy for attached images/videos when the
 * current chat model is text-only. Persisted to config.toml `[media]`.
 */
export function handleMediaCommand(host: SlashCommandHost, args: string): void {
  if (args.trim().length > 0) {
    host.showError(ttui('tui.media.usage'));
    return;
  }
  showMediaFallbackPicker(host);
}

export function showMediaFallbackPicker(host: SlashCommandHost): void {
  const current = host.state.appState.nonVisionFallbackPolicy;
  const mark = (value: string, label: string): string =>
    value === current ? `${label} ✓` : label;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.media.fallback.title'),
      hint: ttui('tui.media.fallback.hint'),
      options: [
        {
          value: 'analyze',
          label: mark('analyze', ttui('tui.media.fallback.analyze')),
          description: ttui('tui.media.fallback.analyzeDesc'),
        },
        {
          value: 'path',
          label: mark('path', ttui('tui.media.fallback.path')),
          description: ttui('tui.media.fallback.pathDesc'),
        },
        {
          value: 'block',
          label: mark('block', ttui('tui.media.fallback.block')),
          description: ttui('tui.media.fallback.blockDesc'),
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'analyze' || value === 'path' || value === 'block') {
          void applyMediaFallbackPolicy(host, value);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}

async function applyMediaFallbackPolicy(
  host: SlashCommandHost,
  policy: 'analyze' | 'path' | 'block',
): Promise<void> {
  try {
    await host.harness.setConfig({ media: { nonVisionFallback: policy } });
    host.setAppState({ nonVisionFallbackPolicy: policy });
    host.showStatus(ttui('tui.media.fallbackSet', { policy }), 'success');
  } catch (error) {
    host.showError(ttui('tui.media.fallbackUpdateFailed', { message: formatErrorMessage(error) }));
  }
}
