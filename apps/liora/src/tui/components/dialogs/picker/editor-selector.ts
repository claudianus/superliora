import { ttui } from '../../../utils/tui-i18n';
import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

export function editorOptions(): ChoiceOption[] {
  return [
    { value: 'code --wait', label: ttui('tui.slash.arg.editor.code-wait') },
    { value: 'vim', label: ttui('tui.slash.arg.editor.vim') },
    { value: 'nvim', label: ttui('tui.slash.arg.editor.nvim') },
    { value: 'nano', label: ttui('tui.slash.arg.editor.nano') },
    { value: '', label: ttui('tui.picker.editor.auto') },
  ];
}

/** Static snapshot for tests that import the option list. */
export const EDITOR_OPTIONS: readonly ChoiceOption[] = editorOptions();

export interface EditorSelectorOptions {
  readonly currentValue: string;
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
}

export class EditorSelectorComponent extends ChoicePickerComponent {
  constructor(opts: EditorSelectorOptions) {
    super({
      title: ttui('tui.picker.editor.title'),
      options: editorOptions(),
      currentValue: opts.currentValue,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
