import {
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from '#/tui/renderer';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';

export type StartPermissionChoice = 'auto' | 'yolo' | 'manual' | 'cancel';

export interface StartPermissionOption<TChoice extends StartPermissionChoice = StartPermissionChoice> {
  readonly value: TChoice;
  readonly label: string;
  readonly description: string;
}

export interface StartPermissionPromptOptions<
  TChoice extends StartPermissionChoice = StartPermissionChoice,
> {
  readonly title: string;
  readonly noticeLines: readonly string[];
  readonly options: readonly StartPermissionOption<TChoice>[];
  readonly onSelect: (choice: TChoice) => void;
  readonly onCancel: () => void;
  readonly initialSelectedIndex?: number;
}

export class StartPermissionPromptComponent<TChoice extends StartPermissionChoice = StartPermissionChoice>
  implements Component, Focusable
{
  focused = false;
  private selectedIndex: number;

  constructor(private readonly opts: StartPermissionPromptOptions<TChoice>) {
    const maxIndex = Math.max(0, opts.options.length - 1);
    const requested = opts.initialSelectedIndex ?? 0;
    this.selectedIndex = Math.max(0, Math.min(requested, maxIndex));
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.opts.options.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      this.opts.onSelect(this.opts.options[this.selectedIndex]!.value);
    }
  }

  render(width: number): string[] {
    const body: string[] = [];
    const textWidth = Math.max(20, width - 2);
    for (const paragraph of this.opts.noticeLines) {
      for (const line of wrapPlain(paragraph, textWidth)) {
        body.push(` ${styleModeNames(line, 'textMuted')}`);
      }
      body.push('');
    }

    for (let i = 0; i < this.opts.options.length; i += 1) {
      const option = this.opts.options[i]!;
      const selected = i === this.selectedIndex;
      const pointer = selected ? SELECT_POINTER : ' ';
      body.push(
        currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `) +
          styleLabel(option.label, selected),
      );
      for (const line of wrapPlain(option.description, Math.max(20, width - 4))) {
        body.push(`    ${styleModeNames(line, 'textMuted')}`);
      }
      body.push('');
    }

    return renderRendererPanelChromeRows({
      width,
      title: ` ${this.opts.title}`,
      hint: ' ↑↓ navigate · Enter select · Esc cancel',
      body,
      footerTopGap: false,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => currentTheme.boldFg('primary', text),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
    });
  }
}

function styleLabel(label: string, selected: boolean): string {
  if (selected) return currentTheme.boldFg('primary', label);
  return styleModeNames(label, 'text');
}

function styleModeNames(text: string, baseToken: 'text' | 'textMuted'): string {
  return text
    .split(/(\b(?:Manual|Auto|YOLO)\b)/g)
    .map((part) => {
      if (part === 'Manual' || part === 'Auto' || part === 'YOLO') return currentTheme.boldFg('textStrong', part);
      return currentTheme.fg(baseToken, part);
    })
    .join('');
}

function wrapPlain(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= width ? word : truncateToWidth(word, width, '…');
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
