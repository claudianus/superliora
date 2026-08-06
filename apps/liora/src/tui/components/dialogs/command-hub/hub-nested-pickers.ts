/**
 * Nested ChoicePickers opened from Command Hub (Esc returns to Hub).
 * On select: close Hub stack and dispatchSlash so existing handlers run.
 */

import { ChoicePickerComponent } from '../picker/choice-picker';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

export interface HubNestedPickerHost {
  dispatchSlash(command: string): void;
  closeAllCenterModals?(): void;
  /** Prefill the editor (e.g. `/swarm msg `) after closing Hub. */
  restoreInputText?(text: string): void;
  mountCenterModal(
    panel: import('../../../renderer').Component & import('../../../renderer').Focusable,
    options?: { readonly mode?: 'push' | 'replace'; readonly label?: string },
  ): void;
  closeCenterModal(): void;
  mountEditorReplacement(
    panel: import('../../../renderer').Component & import('../../../renderer').Focusable,
  ): void;
  restoreEditor(): void;
  state: { readonly centerModalStack?: readonly unknown[] };
}

function runSlashAndCloseHub(host: HubNestedPickerHost, slash: string): void {
  dismissPickerDialog(host);
  host.closeAllCenterModals?.();
  host.dispatchSlash(slash);
}

export function showHubJobOpsPicker(host: HubNestedPickerHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Job ops',
      hint: '↑↓ · Enter · Esc back to Hub',
      searchable: true,
      options: [
        { value: '/job list', label: 'Job list', description: 'Conductor job ledger table' },
        { value: '/job inbox', label: 'Inbox', description: 'Unread job notices' },
        {
          value: '/job resume',
          label: 'Resume…',
          description: 'Re-queue interrupted jobs (handler prompts for id)',
        },
        {
          value: '/job cancel',
          label: 'Cancel…',
          description: 'Cancel a job — needs id when prompted',
        },
        {
          value: '/job inspect',
          label: 'Inspect…',
          description: 'Inspect a job — needs id when prompted',
        },
        { value: '/job schedule', label: 'Schedule…', description: 'Promote queued jobs' },
        { value: '/job gc', label: 'GC', description: 'Worktree GC hint for done jobs' },
      ],
      onSelect: (value) => {
        runSlashAndCloseHub(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Job ops' },
  );
}

export function showHubLoopsPicker(host: HubNestedPickerHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Conversation loops',
      hint: '↑↓ · Enter · Esc back to Hub',
      options: [
        { value: '/loop list', label: 'List loops', description: 'Active in-chat periodic prompts' },
        { value: '/loop stop', label: 'Stop loops', description: 'Stop the active loop (or all)' },
      ],
      onSelect: (value) => {
        runSlashAndCloseHub(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Loops' },
  );
}

export function showHubCronPicker(host: HubNestedPickerHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Cron jobs',
      hint: '↑↓ · Enter · Esc back to Hub',
      options: [
        { value: '/cron list', label: 'List', description: 'Scheduled jobs table' },
        {
          value: '/cron delete',
          label: 'Delete…',
          description: 'Remove a job — needs id when prompted',
        },
      ],
      onSelect: (value) => {
        runSlashAndCloseHub(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Cron' },
  );
}
