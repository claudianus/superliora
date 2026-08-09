/**
 * Settings → Memory — the five Liora Memory operations.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { PlainTextInputDialogComponent } from '../../../components/dialogs/shared/plain-text-input-dialog';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { handleMemoryCommand } from '../../memory/memory';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export function showMemorySettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.memory.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'inspect',
          label: 'Inspect',
          description: 'Store health, audit, and record details',
        },
        {
          value: 'recall',
          label: 'Recall…',
          description: 'Recall by query',
        },
        {
          value: 'remember',
          label: 'Remember…',
          description: 'subject :: content',
        },
        {
          value: 'forget',
          label: 'Forget…',
          description: 'Delete by memory id',
        },
        {
          value: 'reflect',
          label: 'Reflect',
          description: 'Promote and merge candidate memories',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'inspect' || value === 'reflect') {
          void handleMemoryCommand(host, value);
          return;
        }
        if (value === 'recall') {
          promptMemoryArgs(host, {
            title: ttui('tui.settings.pane.memory.recallQuery'),
            prefill: '',
            onDone: (query) => {
              void handleMemoryCommand(host, `recall ${query}`);
            },
          });
          return;
        }
        if (value === 'remember') {
          promptMemoryArgs(host, {
            title: ttui('tui.settings.pane.memory.remember'),
            prefill: '',
            onDone: (args) => {
              void handleMemoryCommand(host, `remember ${args}`);
            },
          });
          return;
        }
        if (value === 'forget') {
          promptMemoryArgs(host, {
            title: ttui('tui.settings.pane.memory.forget'),
            prefill: '',
            onDone: (id) => {
              void handleMemoryCommand(host, `forget ${id}`);
            },
          });
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Memory' },
  );
}

function promptMemoryArgs(
  host: SlashCommandHost,
  options: {
    readonly title: string;
    readonly prefill: string;
    readonly onDone: (value: string) => void;
  },
): void {
  mountPickerDialog(
    host,
    new PlainTextInputDialogComponent({
      title: options.title,
      prefill: options.prefill,
      allowEmpty: false,
      onDone: (result) => {
        dismissPickerDialog(host);
        if (result.kind !== 'ok') return;
        options.onDone(result.value.trim());
      },
    }),
    { label: options.title },
  );
}
