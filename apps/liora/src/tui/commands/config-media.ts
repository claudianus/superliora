import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { formatErrorMessage } from '../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../utils/mount-picker';
import type { SlashCommandHost } from './dispatch';

/**
 * Settings → Media fallback: policy for attached images/videos when the
 * current chat model is text-only. Persisted to config.toml `[media]`.
 */
export function showMediaFallbackPicker(host: SlashCommandHost): void {
  const current = host.state.appState.nonVisionFallbackPolicy;
  const mark = (value: string, label: string): string =>
    value === current ? `${label} ✓` : label;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Media fallback (text-only model)',
      hint: '↑↓ · Enter · Esc',
      options: [
        {
          value: 'analyze',
          label: mark('analyze', 'Analyze with a vision model'),
          description: 'Render attached media to text with a vision-capable catalog model.',
        },
        {
          value: 'path',
          label: mark('path', 'Attach path note'),
          description: 'Replace media with a pointer so a vision tool can read it later.',
        },
        {
          value: 'block',
          label: mark('block', 'Block the send'),
          description: 'Refuse prompts with media while the current model is text-only.',
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
    host.showStatus(`Media fallback set to '${policy}'.`, 'success');
  } catch (error) {
    host.showError(`Failed to update media fallback: ${formatErrorMessage(error)}`);
  }
}
