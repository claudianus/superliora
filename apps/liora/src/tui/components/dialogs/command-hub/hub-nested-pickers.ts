/**
 * Nested ChoicePickers opened from Command Hub (Esc returns to Hub).
 */

import { ChoicePickerComponent } from '../picker/choice-picker';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { ttui } from '../../../utils/tui-i18n';

export interface HubNestedPickerHost {
  dispatchSlash(command: string): void;
  closeAllCenterModals?(): void;
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
      title: ttui('tui.hub.nested.jobOps.title'),
      hint: ttui('tui.hub.nested.common.hint'),
      searchable: true,
      options: [
        {
          value: '/job list',
          label: ttui('tui.hub.nested.jobOps.list.label'),
          description: ttui('tui.hub.nested.jobOps.list.desc'),
        },
        {
          value: '/job inbox',
          label: ttui('tui.hub.nested.jobOps.inbox.label'),
          description: ttui('tui.hub.nested.jobOps.inbox.desc'),
        },
        {
          value: '/job resume',
          label: ttui('tui.hub.nested.jobOps.resume.label'),
          description: ttui('tui.hub.nested.jobOps.resume.desc'),
        },
        {
          value: '/job cancel',
          label: ttui('tui.hub.nested.jobOps.cancel.label'),
          description: ttui('tui.hub.nested.jobOps.cancel.desc'),
        },
        {
          value: '/job inspect',
          label: ttui('tui.hub.nested.jobOps.inspect.label'),
          description: ttui('tui.hub.nested.jobOps.inspect.desc'),
        },
        {
          value: '/job schedule',
          label: ttui('tui.hub.nested.jobOps.schedule.label'),
          description: ttui('tui.hub.nested.jobOps.schedule.desc'),
        },
        { value: '/job gc', label: ttui('tui.hub.nested.jobOps.gc.label'), description: ttui('tui.hub.nested.jobOps.gc.desc') },
        {
          value: '/job split-preview',
          label: ttui('tui.hub.nested.jobOps.splitPreview.label'),
          description: ttui('tui.hub.nested.jobOps.splitPreview.desc'),
        },
        {
          value: '/job mode hotfix',
          label: ttui('tui.hub.nested.jobOps.hotfix.label'),
          description: ttui('tui.hub.nested.jobOps.hotfix.desc'),
        },
        {
          value: '/jobs deck',
          label: ttui('tui.hub.nested.jobOps.deck.label'),
          description: ttui('tui.hub.nested.jobOps.deck.desc'),
        },
      ],
      onSelect: (value) => {
        runSlashAndCloseHub(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.hub.nested.jobOps.title') },
  );
}

export function showHubLoopsPicker(host: HubNestedPickerHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.hub.nested.loops.title'),
      hint: ttui('tui.hub.nested.common.hint'),
      options: [
        {
          value: '/loop list',
          label: ttui('tui.hub.nested.loops.list.label'),
          description: ttui('tui.hub.nested.loops.list.desc'),
        },
        {
          value: '/loop stop',
          label: ttui('tui.hub.nested.loops.stop.label'),
          description: ttui('tui.hub.nested.loops.stop.desc'),
        },
      ],
      onSelect: (value) => {
        runSlashAndCloseHub(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.hub.nested.loops.title') },
  );
}

export function showHubCronPicker(host: HubNestedPickerHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.hub.nested.cron.title'),
      hint: ttui('tui.hub.nested.common.hint'),
      options: [
        {
          value: '/cron list',
          label: ttui('tui.hub.nested.cron.list.label'),
          description: ttui('tui.hub.nested.cron.list.desc'),
        },
        {
          value: '/cron delete',
          label: ttui('tui.hub.nested.cron.delete.label'),
          description: ttui('tui.hub.nested.cron.delete.desc'),
        },
      ],
      onSelect: (value) => {
        runSlashAndCloseHub(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.hub.nested.cron.title') },
  );
}
