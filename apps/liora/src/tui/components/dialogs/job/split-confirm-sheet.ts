/**
 * SplitConfirmSheet — confirm multi-intent JobCreate (≥3) before batch spawn (F09).
 * Keep all / merge to one / cancel. Presentation only; host owns Session RPC.
 */

import {
  Container,
  matchesKey,
  Key,
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';

export interface JobSplitIntent {
  readonly title: string;
  readonly prompt: string;
}

export type SplitConfirmChoice = 'keep' | 'merge' | 'cancel';

export interface SplitConfirmSheetOptions {
  readonly intents: readonly JobSplitIntent[];
  readonly onSelect: (choice: SplitConfirmChoice) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

const CHOICES: readonly {
  readonly value: SplitConfirmChoice;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'keep',
    label: 'Keep all intents',
    description: 'Create one Conductor job per listed intent.',
  },
  {
    value: 'merge',
    label: 'Merge into one job',
    description: 'Combine every intent into a single job prompt.',
  },
  {
    value: 'cancel',
    label: 'Cancel',
    description: 'Do not create jobs.',
  },
];

export class SplitConfirmSheetComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: SplitConfirmSheetOptions;
  private selected = 0;

  constructor(opts: SplitConfirmSheetOptions) {
    super();
    this.opts = opts;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.opts.onSelect(CHOICES[this.selected]!.value);
      return;
    }
    const ch = printableChar(data);
    if (matchesKey(data, Key.up) || ch === 'k') {
      this.selected = Math.max(0, this.selected - 1);
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.down) || ch === 'j') {
      this.selected = Math.min(CHOICES.length - 1, this.selected + 1);
      this.opts.requestRender?.();
      return;
    }
    if (ch === '1' || ch === '2' || ch === '3') {
      this.selected = Number(ch) - 1;
      this.opts.onSelect(CHOICES[this.selected]!.value);
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const intents = this.opts.intents;
    const body: string[] = [];

    for (const [i, intent] of intents.entries()) {
      if (i >= 6) {
        body.push(theme.fg('textDim', `  … +${String(intents.length - 6)} more`));
        break;
      }
      body.push(
        truncateToWidth(
          `  ${theme.fg('textMuted', `${String(i + 1)}.`)} ${theme.fg('text', intent.title)}`,
          width,
        ),
      );
    }
    body.push('');

    for (const [i, choice] of CHOICES.entries()) {
      const selected = i === this.selected;
      const pointer = selected
        ? renderSelectPointer('job-split:pointer')
        : ' '.repeat(visibleWidth(SELECT_POINTER));
      const label = selected
        ? theme.boldFg('primary', choice.label)
        : theme.fg('text', choice.label);
      body.push(`  ${pointer} ${label}`);
      if (selected) {
        body.push(theme.fg('textMuted', `     ${choice.description}`));
      }
    }

    return renderRendererPanelChromeRows({
      width,
      title: ` Split into ${String(intents.length)} jobs?`,
      hint: ' ↑↓/jk · Enter · 1–3 · Esc',
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'job-split:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
      ellipsis: '…',
    });
  }
}

/** Resolve confirmed intents (or null on cancel). */
export function resolveSplitConfirmChoice(
  intents: readonly JobSplitIntent[],
  choice: SplitConfirmChoice,
): readonly JobSplitIntent[] | null {
  if (choice === 'cancel') return null;
  if (choice === 'keep') return intents;
  const prompt = intents.map((intent) => intent.prompt).join('\n\n');
  const title =
    intents.length === 0
      ? 'Combined job'
      : intents.length === 1
        ? intents[0]!.title
        : `${intents[0]!.title} (+${String(intents.length - 1)})`;
  return [{ title, prompt }];
}
