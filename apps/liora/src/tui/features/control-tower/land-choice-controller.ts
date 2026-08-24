/**
 * Keep / Apply / PR picker after a coding session finishes.
 */

import { ChoicePickerComponent, type ChoiceOption } from '../../components/dialogs/picker/choice-picker';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { isConductorUxV2Enabled } from '../../commands/job-hotpath';
import { ttui } from '../../utils/tui-i18n';
import {
  dismissPickerDialog,
  mountPickerDialog,
} from '../../utils/ui/mount-picker';
import { resyncJobBoardFromSession } from './job-resync';

export async function openLandChoicePicker(
  host: SlashCommandHost,
  jobId: string,
): Promise<void> {
  if (host.session === undefined) {
    host.showError(ttui('tui.jobs.deckNoSession'));
    return;
  }
  if (!isConductorUxV2Enabled()) {
    host.showStatus(ttui('tui.jobs.drawerNeedsUx'), 'warning');
    return;
  }
  const options: ChoiceOption[] = [
    {
      value: 'keep',
      label: ttui('tui.jobs.landKeep'),
      description: ttui('tui.jobs.landKeepHint'),
    },
    {
      value: 'apply',
      label: ttui('tui.jobs.landApply'),
      description: ttui('tui.jobs.landApplyHint'),
    },
    {
      value: 'pr',
      label: ttui('tui.jobs.landPr'),
      description: ttui('tui.jobs.landPrHint'),
    },
  ];
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.jobs.landTitle', { id: shortJobId(jobId) }),
      hint: ttui('tui.jobs.landHint'),
      options,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyLandChoice(host, jobId, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}

async function applyLandChoice(
  host: SlashCommandHost,
  jobId: string,
  value: string,
): Promise<void> {
  if (value !== 'keep' && value !== 'apply' && value !== 'pr') return;
  try {
    const result = await host.requireSession().jobLandChoice({ jobId, choice: value });
    if (!result.ok) {
      host.showError(result.error ?? result.text);
      return;
    }
    host.showStatus(result.text, 'success');
    await resyncJobBoardFromSession(host);
  } catch (error) {
    host.showError(error instanceof Error ? error.message : ttui('tui.jobs.landFailed'));
  }
}
