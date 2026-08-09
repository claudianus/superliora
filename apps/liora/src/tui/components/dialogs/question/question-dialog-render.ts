import {
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { ttui } from '#/tui/utils/tui-i18n';

import type { Input } from '../shared/input';
import {
  MAX_BODY_LINES,
  NOT_ANSWERED_LABEL,
  NUMBER_KEYS,
  REVIEW_TITLE,
  SUBMIT_ACTIONS,
  SUBMIT_PROMPT,
  UNANSWERED_WARNING,
  type DisplayOption,
} from './question-dialog-constants';
import { appendWrapped } from './question-dialog-wrap';
import type { PendingQuestion } from '#/tui/reverse-rpc/types';

export interface QuestionDialogRenderHost {
  readonly request: PendingQuestion;
  readonly currentTab: number;
  readonly submitActionIdx: number;
  readonly editingOther: boolean;
  readonly reviewMessage: string | undefined;
  readonly cursors: readonly number[];
  readonly singleSelections: readonly (number | undefined)[];
  readonly multiSelections: readonly Set<number>[];
  readonly otherDrafts: readonly string[];
  readonly committedOtherValues: readonly (string | undefined)[];
  readonly answers: readonly (string | undefined)[];
  readonly maxVisibleOptions: number;
  readonly otherInput: Input;

  isSubmitTab(): boolean;
  isEditingOther(): boolean;
  currentQuestionIndex(): number | undefined;
  currentCursor(): number;
  displayOptions(questionIdx: number): DisplayOption[];
  isOtherOption(questionIdx: number, optionIdx: number): boolean;
  isAnswered(questionIdx: number): boolean;
  hasUnansweredQuestions(): boolean;
  otherDraftValue(questionIdx: number): string;
  totalTabs(): number;
}

export function computeVisibleStart(
  host: QuestionDialogRenderHost,
  cursor: number,
  total: number,
): number {
  if (total <= host.maxVisibleOptions) return 0;
  const half = Math.floor(host.maxVisibleOptions / 2);
  const max = Math.max(0, total - host.maxVisibleOptions);
  return Math.max(0, Math.min(cursor - half, max));
}

export function renderQuestionDialog(host: QuestionDialogRenderHost, width: number): string[] {
  host.otherInput.focused = host.isEditingOther();
  return host.isSubmitTab() ? renderSubmitTab(host, width) : renderQuestionTab(host, width);
}

function renderQuestionTab(host: QuestionDialogRenderHost, width: number): string[] {
  const questionIdx = host.currentQuestionIndex();
  if (questionIdx === undefined) return renderSubmitTab(host, width);

  const question = host.request.data.questions[questionIdx];
  if (question === undefined) return [];

  const accent = (text: string) => currentTheme.fg('primary', text);
  const dim = (text: string) => currentTheme.fg('textDim', text);
  const success = (text: string) => currentTheme.fg('success', text);

  const renderWidth = Math.max(1, width);
  const body: string[] = [];
  pushTabs(host, body);
  body.push('');

  appendWrapped(body, ' ? ', '   ', question.question, renderWidth, accent);
  if (host.isEditingOther()) {
    body.push(dim('   Type your answer, then press Enter to save.'));
  }

  if (question.body !== undefined && question.body.trim().length > 0) {
    body.push('');
    const bodyLines = question.body.trim().split('\n');
    const visibleBodyLines = bodyLines.slice(0, MAX_BODY_LINES);
    for (const bodyLine of visibleBodyLines) {
      appendWrapped(body, '   ', '   ', bodyLine, renderWidth, dim);
    }
    if (bodyLines.length > visibleBodyLines.length) {
      body.push(dim(`   ... ${String(bodyLines.length - visibleBodyLines.length)} more lines`));
    }
  }

  body.push('');

  const options = host.displayOptions(questionIdx);
  const cursor = host.currentCursor();
  const visibleStart = computeVisibleStart(host, cursor, options.length);
  const visibleEnd = Math.min(options.length, visibleStart + host.maxVisibleOptions);
  const multiSet = host.multiSelections[questionIdx] ?? new Set<number>();
  const singleSelection = host.singleSelections[questionIdx];

  for (let i = visibleStart; i < visibleEnd; i++) {
    const option = options[i];
    if (option === undefined) continue;
    const num = i + 1;
    const isCursor = i === cursor;
    const isOther = option.kind === 'other';
    const isSelected = question.multi_select ? multiSet.has(i) : singleSelection === i;

    if (host.isEditingOther() && isCursor && isOther) {
      body.push(renderEditingOtherLine(host, renderWidth, questionIdx, option, num, isSelected));
      continue;
    }

    const label = renderOptionLabel(host, questionIdx, option, isCursor);

    let tone: (s: string) => string;
    let prefix: string;
    if (question.multi_select) {
      const checked = isSelected ? '✓' : ' ';
      prefix = `  [${checked}] `;
      if (isSelected && isCursor) tone = (s) => currentTheme.boldFg('success', s);
      else if (isSelected) tone = success;
      else if (isCursor) tone = accent;
      else tone = dim;
    } else if (isSelected && host.isAnswered(questionIdx)) {
      prefix = isCursor ? `  ${renderSelectPointer('question:pointer')} ` : '    ';
      const numbered = `[${String(num)}] `;
      tone = isCursor ? (s) => currentTheme.boldFg('success', s) : success;
      const continuation = ' '.repeat(visibleWidth(prefix) + visibleWidth(numbered));
      appendWrapped(body, prefix, continuation, numbered + label, renderWidth, (s) => {
        if (isCursor && s.startsWith(prefix)) {
          return prefix + tone(s.slice(prefix.length));
        }
        return tone(s);
      });
      if (
        option.description !== undefined &&
        option.description.length > 0 &&
        !(host.isEditingOther() && isCursor && isOther)
      ) {
        appendWrapped(body, '        ', '        ', option.description, renderWidth, dim);
      }
      continue;
    } else if (isCursor) {
      prefix = `  ${renderSelectPointer('question:pointer')} `;
      const numbered = `[${String(num)}] `;
      tone = accent;
      const continuation = ' '.repeat(visibleWidth(prefix) + visibleWidth(numbered));
      appendWrapped(body, prefix, continuation, numbered + label, renderWidth, (s) => {
        if (s.startsWith(prefix)) return prefix + tone(s.slice(prefix.length));
        return tone(s);
      });
      if (
        option.description !== undefined &&
        option.description.length > 0 &&
        !(host.isEditingOther() && isCursor && isOther)
      ) {
        appendWrapped(body, '        ', '        ', option.description, renderWidth, dim);
      }
      continue;
    } else {
      prefix = `    [${String(num)}] `;
      tone = dim;
    }
    const continuation = ' '.repeat(visibleWidth(prefix));
    appendWrapped(body, prefix, continuation, label, renderWidth, tone);

    if (
      option.description !== undefined &&
      option.description.length > 0 &&
      !(host.isEditingOther() && isCursor && isOther)
    ) {
      appendWrapped(body, '        ', '        ', option.description, renderWidth, dim);
    }
  }

  if (visibleEnd < options.length || visibleStart > 0) {
    body.push(
      dim(
        `   showing ${String(visibleStart + 1)}-${String(visibleEnd)} of ${String(options.length)}`,
      ),
    );
  }

  return renderRendererPanelChromeRows({
    width: renderWidth,
    title: ttui('tui.dialog.question.title'),
    body,
    footer: [buildQuestionHint(host, dim, questionIdx)],
    dividerStyle: accent,
    titleStyle: (text) => currentTheme.boldFg('primary', text),
  }).map((line) => truncateToWidth(line, width));
}

function renderSubmitTab(host: QuestionDialogRenderHost, width: number): string[] {
  const accent = (text: string) => currentTheme.fg('primary', text);
  const dim = (text: string) => currentTheme.fg('textDim', text);
  const text = (t: string) => currentTheme.fg('text', t);
  const warning = (text: string) => currentTheme.fg('warning', text);

  const renderWidth = Math.max(1, width);
  const body: string[] = [];
  pushTabs(host, body);
  body.push('');
  body.push(currentTheme.boldFg('text', ` ${REVIEW_TITLE}`));
  const reviewWarning =
    host.reviewMessage ?? (host.hasUnansweredQuestions() ? UNANSWERED_WARNING : undefined);
  if (reviewWarning !== undefined) {
    body.push(warning(`  ${reviewWarning}`));
  }
  body.push('');

  for (let i = 0; i < host.request.data.questions.length; i++) {
    const question = host.request.data.questions[i];
    if (question === undefined) continue;
    const answer = host.answers[i];
    appendWrapped(body, `  ${dim('Q')}  `, '       ', question.question, renderWidth);
    if (answer !== undefined && answer.length > 0) {
      appendWrapped(body, `  ${accent('·')}  `, '       ', text(answer), renderWidth);
    } else {
      body.push(`  ${dim('·')}  ${dim(NOT_ANSWERED_LABEL)}`);
    }
  }

  body.push('');
  body.push(text(` ${SUBMIT_PROMPT}`));
  body.push('');

  for (let i = 0; i < SUBMIT_ACTIONS.length; i++) {
    const label = SUBMIT_ACTIONS[i];
    if (label === undefined) continue;
    const num = i + 1;
    if (i === host.submitActionIdx) {
      body.push(
        `  ${renderSelectPointer('question:pointer')} ${accent(`[${String(num)}] ${label}`)}`,
      );
    } else {
      body.push(dim(`    [${String(num)}] ${label}`));
    }
  }

  return renderRendererPanelChromeRows({
    width: renderWidth,
    title: ttui('tui.dialog.question.title'),
    body,
    footer: [buildSubmitHint(host, dim)],
    dividerStyle: accent,
    titleStyle: (titleText) => currentTheme.boldFg('primary', titleText),
  }).map((line) => truncateToWidth(line, width));
}

function pushTabs(host: QuestionDialogRenderHost, lines: string[]): void {
  const dim = (text: string) => currentTheme.fg('textDim', text);
  const active = (text: string) => currentTheme.bg('primary', currentTheme.boldFg('text', text));

  const tabs: string[] = [];
  for (let i = 0; i < host.request.data.questions.length; i++) {
    const question = host.request.data.questions[i];
    if (question === undefined) continue;
    const label =
      question.header !== undefined && question.header.length > 0
        ? question.header
        : `Q${String(i + 1)}`;
    if (i === host.currentTab) tabs.push(active(` ${label} `));
    else if (host.isAnswered(i)) tabs.push(currentTheme.fg('success', `(✓) ${label}`));
    else tabs.push(dim(`(○) ${label}`));
  }

  const submitLabel = 'Submit';
  if (host.isSubmitTab()) tabs.push(active(` ${submitLabel} `));
  else tabs.push(dim(` ${submitLabel} `));

  lines.push(` ${tabs.join('  ')}`);
}

function buildQuestionHint(
  host: QuestionDialogRenderHost,
  dim: (s: string) => string,
  questionIdx: number,
): string {
  if (host.isEditingOther()) {
    const parts: string[] = [
      'type answer',
      '↵ save',
      ...(host.totalTabs() > 1 ? ['tab switch'] : []),
      'esc cancel',
    ];
    return dim(`  ${parts.join('  ')}`);
  }

  const optionCount = Math.min(host.displayOptions(questionIdx).length, NUMBER_KEYS.length);
  const numberHint = optionCount <= 1 ? '1' : `1-${String(optionCount)}`;
  const question = host.request.data.questions[questionIdx];
  if (question === undefined) return dim('  esc cancel');

  const parts: string[] = [
    '↑↓ select',
    `${numberHint} / ↵ ${question.multi_select ? 'toggle' : 'choose'}`,
  ];
  if (host.totalTabs() > 1) parts.push('←/→/tab switch');
  parts.push('esc cancel');
  return dim(`  ${parts.join('  ')}`);
}

function buildSubmitHint(host: QuestionDialogRenderHost, dim: (s: string) => string): string {
  const parts: string[] = ['↑↓ select', '1/2 choose', '↵ confirm'];
  if (host.totalTabs() > 1) parts.push('←/→/tab switch');
  parts.push('esc cancel');
  return dim(`  ${parts.join('  ')}`);
}

function renderOptionLabel(
  host: QuestionDialogRenderHost,
  questionIdx: number,
  option: DisplayOption,
  isCursor: boolean,
): string {
  if (option.kind !== 'other') return option.label;

  const value = host.otherDraftValue(questionIdx);
  if (host.isEditingOther() && isCursor) {
    return `${option.label}: ${value ?? ''}█`;
  }
  if (value !== undefined && value.length > 0) return `${option.label}: ${value}`;
  return option.label;
}

function renderEditingOtherLine(
  host: QuestionDialogRenderHost,
  width: number,
  questionIdx: number,
  option: DisplayOption,
  num: number,
  isSelected: boolean,
): string {
  const question = host.request.data.questions[questionIdx];
  if (question === undefined) return option.label;

  let prefix: string;
  if (question.multi_select) {
    const checked = isSelected ? '✓' : ' ';
    const body = `  [${checked}] ${option.label}: `;
    prefix = isSelected
      ? currentTheme.boldFg('success', body)
      : currentTheme.fg('primary', body);
  } else {
    const pointer = renderSelectPointer('question:pointer');
    const plain = `[${String(num)}] ${option.label}: `;
    const styled =
      isSelected && host.isAnswered(questionIdx)
        ? currentTheme.boldFg('success', plain)
        : currentTheme.fg('primary', plain);
    prefix = `  ${pointer} ${styled}`;
  }

  const inputWidth = Math.max(4, width - visibleWidth(prefix) + 2);
  const inputLine = host.otherInput.render(inputWidth)[0] ?? '> ';
  const inlineInput = inputLine.startsWith('> ') ? inputLine.slice(2) : inputLine;
  return prefix + inlineInput;
}
