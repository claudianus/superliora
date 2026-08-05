/**
 * Settings → Memory — Liora Recall actions via existing /memory handlers (no new config keys).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { PlainTextInputDialogComponent } from '../../../components/dialogs/shared/plain-text-input-dialog';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { handleMemoryCommand } from '../../memory/memory';

import type { SlashCommandHost } from '../../hub/dispatch';

export function showMemorySettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Memory (Liora Recall)',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'stats',
          label: 'Stats',
          description: 'Active / total counts by kind',
        },
        {
          value: 'list',
          label: 'List memories',
          description: 'Recent stored memories',
        },
        {
          value: 'search',
          label: 'Search…',
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
          value: 'wiki',
          label: 'LLM Wiki status',
          description: 'Project wiki / evidence roots',
        },
        {
          value: 'consolidate',
          label: 'Consolidate',
          description: 'Merge duplicate memories',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'stats') {
          void handleMemoryCommand(host, 'stats');
          return;
        }
        if (value === 'list') {
          void handleMemoryCommand(host, 'list');
          return;
        }
        if (value === 'wiki') {
          void handleMemoryCommand(host, 'wiki');
          return;
        }
        if (value === 'consolidate') {
          void handleMemoryCommand(host, 'consolidate');
          return;
        }
        if (value === 'search') {
          promptMemoryArgs(host, {
            title: 'Memory search',
            prefill: '',
            onDone: (query) => {
              void handleMemoryCommand(host, `search ${query}`);
            },
          });
          return;
        }
        if (value === 'remember') {
          promptMemoryArgs(host, {
            title: 'Remember (subject :: content)',
            prefill: '',
            onDone: (args) => {
              void handleMemoryCommand(host, `remember ${args}`);
            },
          });
          return;
        }
        if (value === 'forget') {
          promptMemoryArgs(host, {
            title: 'Forget memory id',
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
