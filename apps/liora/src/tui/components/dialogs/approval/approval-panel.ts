/**
 * ApprovalPanel — approval request UI.
 *
 * Container-based component with keyboard navigation.
 */

import {
  Container,
  matchesKey,
  Key,
  type Focusable,
  renderRendererPanelChromeRows,
  visibleWidth,
  wrapTextWithAnsi,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { Input } from '../shared/input';
import { highlightShellCommandLine } from '#/tui/components/media/code-highlight';
import type {
  ApprovalPanelChoice,
  DisplayBlock,
  PendingApproval,
} from '#/tui/reverse-rpc/types';
import { printableChar } from '#/tui/utils/printable-key';
import { ttui } from '#/tui/utils/tui-i18n';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderDangerBreathe,
  renderSettleFlash,
  resolveQualityAdjustedAmbientEffectMode,
  SETTLE_FLASH_MS,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';

export interface ApprovalPanelResponse {
  readonly response: 'approved' | 'approved_for_session' | 'rejected' | 'cancelled';
  readonly feedback?: string | undefined;
  readonly selected_label?: string | undefined;
}


interface BlockStyles {
  strong: (s: string) => string;
  dim: (s: string) => string;
  accent: (s: string) => string;
  errorBold: (s: string) => string;
}

function makeBlockStyles(): BlockStyles {
  return {
    strong: (s) => currentTheme.fg('textStrong', s),
    dim: (s) => currentTheme.fg('textDim', s),
    accent: (s) => currentTheme.fg('accent', s),
    errorBold: (s) => currentTheme.boldFg('error', s),
  };
}

function appendWrappedLine(
  lines: string[],
  firstPrefix: string,
  continuationPrefix: string,
  content: string,
  width: number,
): void {
  const prefixWidth = Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix));
  const wrapped = wrapTextWithAnsi(content, Math.max(1, width - prefixWidth));
  if (wrapped.length === 0) {
    lines.push(firstPrefix);
    return;
  }
  lines.push(`${firstPrefix}${wrapped[0] ?? ''}`);
  for (let i = 1; i < wrapped.length; i++) {
    lines.push(`${continuationPrefix}${wrapped[i] ?? ''}`);
  }
}

function renderShellDisplayBlock(
  block: Extract<DisplayBlock, { type: 'shell' }>,
  s: BlockStyles,
  width: number,
): string[] {
  const lines: string[] = [];
  if (block.cwd !== undefined && block.cwd.length > 0) {
    lines.push(s.dim(`cwd: ${block.cwd}`));
  }
  if (block.danger !== undefined) {
    lines.push(s.errorBold(ttui('tui.approval.dangerous', { label: block.danger })));
  }
  const breatheDanger = block.danger !== undefined;
  const cmdLines = block.command.length > 0 ? block.command.split('\n') : [''];
  cmdLines.forEach((cmdLine, idx) => {
    const prefix = idx === 0 ? `${s.accent('$')} ` : `${s.dim('·')} `;
    // Dangerous commands keep the breathe effect on plain text so the
    // animation is not fighting nested ANSI. Safe commands get token colors.
    const styledCmd = breatheDanger
      ? renderDangerBreathe(cmdLine, `approval:danger:${idx}`)
      : highlightShellCommandLine(cmdLine);
    appendWrappedLine(lines, prefix, '  ', styledCmd, width);
  });
  if (block.description !== undefined && block.description.length > 0) {
    lines.push(`  ${s.dim(block.description)}`);
  }
  return lines;
}

function renderDisplayBlock(
  block: DisplayBlock,
  s: BlockStyles,
  contentWidth: number,
): string[] {
  switch (block.type) {
    case 'shell':
      return renderShellDisplayBlock(block, s, contentWidth);
    case 'brief':
      return block.text
        ? block.text.split('\n').map((line) => (line.length > 0 ? s.strong(line) : ''))
        : [];
  }
}

function normalizeApprovalText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim();
}

function isDuplicateBriefBlock(block: DisplayBlock, description: string): boolean {
  if (block.type !== 'brief' || block.text.trim().length === 0) return false;
  const normalizedDescription = normalizeApprovalText(description);
  if (normalizedDescription.length === 0) return false;
  const normalizedBlockText = normalizeApprovalText(block.text);
  if (normalizedBlockText === normalizedDescription) return true;
  const blockLines = normalizedBlockText.split('\n');
  if (blockLines.length <= 1) return false;
  return normalizeApprovalText(blockLines.slice(1).join('\n')) === normalizedDescription;
}

function headerFor(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'Run this command?';
    default:
      return `Approve ${toolName}?`;
  }
}

export class ApprovalPanelComponent extends Container implements Focusable {
  focused = false;
  private selectedIndex = 0;
  private feedbackMode = false;
  private readonly feedbackInput = new Input();
  private onResponse: (response: ApprovalPanelResponse) => void;
  private request: PendingApproval;
  private readonly onToggleToolOutput: (() => void) | undefined;
  /** Mount clock for optional enter-beat / motion seeds. */
  private readonly openedAtMs = appearanceAnimationNow();
  private settleStartedAtMs: number | undefined;
  private settleRowId: number | undefined;

  constructor(
    request: PendingApproval,
    onResponse: (response: ApprovalPanelResponse) => void,
    onToggleToolOutput?: () => void,
  ) {
    super();
    this.request = request;
    this.onResponse = onResponse;
    this.onToggleToolOutput = onToggleToolOutput;
    this.feedbackInput.onSubmit = (value) => {
      this.submit(this.selectedIndex, value);
    };
    this.feedbackInput.onEscape = () => {
      this.feedbackMode = false;
      this.feedbackInput.setValue('');
    };
  }

  private markSelectionSettle(index: number): void {
    this.settleStartedAtMs = appearanceAnimationNow();
    this.settleRowId = index;
  }

  private moveSelection(delta: number): void {
    const count = this.choiceCount();
    if (count === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.markSelectionSettle(this.selectedIndex);
  }

  private settleMs(): number {
    const mode = resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences());
    return mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS;
  }

  private styleChoiceLabel(labelWithNum: string, index: number, selected: boolean): string {
    const appearance = getActiveAppearancePreferences();
    if (
      selected &&
      shouldRenderAmbientEffects(appearance) &&
      this.settleRowId === index &&
      this.settleStartedAtMs !== undefined &&
      appearanceAnimationNow() - this.settleStartedAtMs < this.settleMs()
    ) {
      return renderSettleFlash(
        labelWithNum,
        `approval:settle:${String(this.openedAtMs)}:${String(index)}`,
        this.settleStartedAtMs,
        appearance,
      );
    }
    if (selected) return currentTheme.boldFg('accent', labelWithNum);
    return currentTheme.fg('textStrong', labelWithNum);
  }

  private submit(index: number, feedback: string = ''): void {
    const option = this.choiceAt(index);
    if (!option) return;
    this.onResponse({
      response: option.response,
      feedback: feedback || undefined,
      selected_label: option.selected_label,
    });
  }

  private selectAndSubmit(index: number): void {
    const option = this.choiceAt(index);
    if (!option) return;
    if (option.requires_feedback === true) {
      if (this.selectedIndex !== index) this.markSelectionSettle(index);
      this.selectedIndex = index;
      this.feedbackMode = true;
    } else {
      this.submit(index);
    }
  }

  handleInput(data: string): void {
    // Inside the feedback editor Esc cancels the input (back to the choice
    // list) instead of rejecting the whole tool call — the response is
    // irreversible, so a mid-edit Esc must not submit it.
    if (this.feedbackMode && matchesKey(data, Key.escape)) {
      this.feedbackInput.onEscape?.();
      return;
    }
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.onResponse({ response: 'rejected' });
      return;
    }


    if (matchesKey(data, Key.ctrl('o'))) {
      this.onToggleToolOutput?.();
      return;
    }

    if (this.feedbackMode) {
      if (matchesKey(data, Key.up)) {
        this.feedbackMode = false;
        this.moveSelection(-1);
        return;
      }
      if (matchesKey(data, Key.down)) {
        this.feedbackMode = false;
        this.moveSelection(1);
        return;
      }
      this.feedbackInput.handleInput(data);
      return;
    }

    if (this.choiceCount() === 0) return;
    if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.selectAndSubmit(this.selectedIndex);
      return;
    }

    const printable = printableChar(data);
    const numericIndex = Number(printable) - 1;
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < this.choiceCount()) {
      this.selectAndSubmit(numericIndex);
    }
  }

  override render(width: number): string[] {
    this.clear();
    this.ensureValidSelection();
    this.feedbackInput.focused = this.focused && this.feedbackMode;
    const { data } = this.request;
    const blockStyles = makeBlockStyles();
    const borderColor = (text: string) => currentTheme.fg('borderFocus', text);
    const borderColorBold = (text: string) => currentTheme.boldFg('borderFocus', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const indent = (s: string): string => `  ${s}`;

    const title = headerFor(data.tool_name);
    const body: string[] = [];

    const dedupedBlocks = data.display.filter(
      (block) => !isDuplicateBriefBlock(block, data.description),
    );
    const visibleBlocks = dedupedBlocks.slice(0, 5);

    if (visibleBlocks.length > 0) {
      for (const block of visibleBlocks) {
        const blockLines = renderDisplayBlock(
          block,
          blockStyles,
          Math.max(1, width - 2),
        );
        for (const line of blockLines) {
          body.push(indent(line));
        }
      }
    } else if (data.description) {
      for (const descLine of data.description.split('\n')) {
        body.push(indent(dim(descLine)));
      }
    }

    if (body.length > 0) body.push('');
    for (let idx = 0; idx < data.choices.length; idx++) {
      const option = data.choices[idx];
      if (option === undefined) continue;
      const isSelected = idx === this.selectedIndex;
      const num = idx + 1;

      const labelWithNum = `${String(num)}. ${option.label}`;
      // Pointer is already ambient-styled; do not wrap it in chalk again.
      const pointer = isSelected ? renderSelectPointer('approval:pointer') : ' ';
      if (this.feedbackMode && option.requires_feedback === true && isSelected) {
        body.push(indent(this.renderInlineFeedbackLine(width - 2, labelWithNum, pointer, idx)));
      } else {
        body.push(indent(`  ${pointer} ${this.styleChoiceLabel(labelWithNum, idx, isSelected)}`));
      }

      // Optional helper text under the label, aligned past the pointer/number.
      // Choices without a description render exactly as before.
      if (
        option.description !== undefined &&
        option.description.length > 0 &&
        !(this.feedbackMode && option.requires_feedback === true && isSelected)
      ) {
        for (const descLine of wrapTextWithAnsi(option.description, Math.max(20, width - 7))) {
          body.push(indent(`     ${dim(descLine)}`));
        }
      }
    }

    body.push('');
    if (this.feedbackMode) {
      body.push(indent(dim('Type feedback · Enter submit.')));
    } else {
      body.push(
        indent(
          dim(
            `↑↓ select · ${buildNumericHint(data.choices.length)} choose · Enter confirm`,
          ),
        ),
      );
    }

    return renderRendererPanelChromeRows({
      width,
      title: ` ${title}`,
      body,
      footerTopGap: false,
      dividerStyle: borderColor,
      titleStyle: borderColorBold,
    });
  }


  private choiceAt(index: number): ApprovalPanelChoice | undefined {
    return this.request.data.choices[index];
  }

  private choiceCount(): number {
    return this.request.data.choices.length;
  }

  private ensureValidSelection(): void {
    const count = this.choiceCount();
    if (count === 0) {
      this.selectedIndex = 0;
      return;
    }
    if (this.selectedIndex < 0 || this.selectedIndex >= count) {
      this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, count - 1));
    }
  }

  private renderInlineFeedbackLine(
    width: number,
    labelWithNum: string,
    pointer: string,
    index: number,
  ): string {
    // Keep pointer outside chalk so nested SGR never re-enters a plain-text sink.
    const prefix = `  ${pointer} ${this.styleChoiceLabel(labelWithNum, index, true)}  `;
    const inputWidth = Math.max(4, width - visibleWidth(prefix) + 2);
    const inputLine = this.feedbackInput.render(inputWidth)[0] ?? '> ';
    const inlineInput = inputLine.startsWith('> ') ? inputLine.slice(2) : inputLine;
    return prefix + inlineInput;
  }

  override invalidate(): void {
    super.invalidate();
    this.feedbackInput.invalidate();
  }
}

function buildNumericHint(count: number): string {
  if (count <= 0) return '↵';
  return Array.from({ length: Math.min(count, 9) }, (_, idx) => String(idx + 1)).join('/');
}
