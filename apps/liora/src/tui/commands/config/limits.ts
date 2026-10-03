import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { PlainTextInputDialogComponent } from '../../components/dialogs/shared/plain-text-input-dialog';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import { formatErrorMessage } from '../../utils/event-payload';
import type { SlashCommandHost } from '../hub/dispatch';
import { ttui } from '../../utils/tui-i18n';

export async function showExecutionLimitsSettings(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig({ reload: true });
    const current = config.loopControl?.maxStepsPerTurn ?? 0;
    mountPickerDialog(host, new ChoicePickerComponent({
      title: 'Execution limits',
      options: [{
        value: 'steps',
        label: `Maximum steps per turn · ${current === 0 ? 'unlimited' : current}`,
        description: 'A user hard limit. Zero allows the agent to continue until its turn ends.',
      }],
      onSelect: () => {
        dismissPickerDialog(host);
        mountPickerDialog(host, new PlainTextInputDialogComponent({
          title: 'Maximum steps per turn',
          prefill: String(current),
          allowEmpty: false,
          subtitleLines: ['Enter a non-negative whole number. Zero means unlimited.'],
          onDone: (result) => {
            dismissPickerDialog(host);
            if (result.kind === 'ok') void applyExecutionStepLimit(host, result.value);
          },
        }));
      },
      onCancel: () => dismissPickerDialog(host),
    }));
  } catch (error) {
    host.showError(formatErrorMessage(error));
  }
}

export async function applyExecutionStepLimit(host: SlashCommandHost, value: string): Promise<void> {
  const text = value.trim();
  const limit = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(limit)) {
    host.showError(ttui('tui.limits.invalidSteps'));
    return;
  }
  try {
    const config = await host.harness.getConfig({ reload: true });
    await host.harness.setConfig({ loopControl: { ...config.loopControl, maxStepsPerTurn: limit } });
    await host.session?.reloadSession();
    host.showStatus(ttui('tui.limits.stepsApplied', {
      limit: limit === 0 ? ttui('tui.limits.unlimited') : limit,
    }), 'success');
  } catch (error) {
    host.showError(formatErrorMessage(error));
  }
}
