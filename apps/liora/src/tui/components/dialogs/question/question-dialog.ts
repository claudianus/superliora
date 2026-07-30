/**
 * QuestionDialog — pi-tui version of the structured question prompt.
 *
 * Each question collects an answer locally, and a final Submit tab
 * reviews everything before the answers are emitted upstream.
 */

import { Container, type Focusable } from '#/tui/renderer';

import { Input } from '../shared/input';
import type { DisplayOption } from './question-dialog-constants';
import { handleQuestionDialogInput } from './question-dialog-input';
import {
  buildDisplayOptions,
  isOtherOption as isOtherOptionForQuestion,
  otherOptionIndex as otherOptionIndexForQuestion,
} from './question-dialog-options';
import { renderQuestionDialog, type QuestionDialogRenderHost } from './question-dialog-render';
import type {
  PendingQuestion,
  QuestionPanelResponse,
  QuestionSubmissionMethod,
} from '#/tui/reverse-rpc/types';

export class QuestionDialogComponent
  extends Container
  implements Focusable, QuestionDialogRenderHost
{
  focused = false;

  readonly request: PendingQuestion;
  readonly maxVisibleOptions: number;
  readonly otherInput = new Input();

  currentTab = 0;
  submitActionIdx = 0;
  editingOther = false;
  reviewMessage: string | undefined;
  lastAnswerMethod: QuestionSubmissionMethod | undefined;

  /** Per-question cursor position. */
  readonly cursors: number[];
  /** Per-question single-select choice. */
  readonly singleSelections: (number | undefined)[];
  /** Per-question multi-select choices. */
  readonly multiSelections: Set<number>[];
  /** Per-question free-text drafts for the synthetic Other option. */
  readonly otherDrafts: string[];
  /** Per-question committed Other values. */
  readonly committedOtherValues: (string | undefined)[];
  /** Per-question derived answers used by tabs + review. */
  readonly answers: (string | undefined)[];

  readonly onToggleToolOutput: (() => void) | undefined;

  private readonly answerCallback: (response: QuestionPanelResponse) => void;

  constructor(
    request: PendingQuestion,
    onAnswer: (response: QuestionPanelResponse) => void,
    maxVisibleOptions = 6,
    onToggleToolOutput?: () => void,
  ) {
    super();
    this.request = request;
    this.answerCallback = onAnswer;
    this.maxVisibleOptions = maxVisibleOptions;
    this.onToggleToolOutput = onToggleToolOutput;
    this.otherInput.onSubmit = (value) => {
      this.commitOtherInput(value, 'enter');
    };

    const total = request.data.questions.length;
    this.cursors = Array.from({ length: total }, (): number => 0);
    this.singleSelections = Array.from({ length: total }, (): number | undefined => undefined);
    this.multiSelections = Array.from({ length: total }, () => new Set<number>());
    this.otherDrafts = Array.from({ length: total }, (): string => '');
    this.committedOtherValues = Array.from({ length: total }, (): string | undefined => undefined);
    this.answers = Array.from({ length: total }, (): string | undefined => undefined);
  }

  // ── Input ─────────────────────────────────────────────────────────

  handleInput(data: string): void {
    handleQuestionDialogInput(this, data);
  }

  onAnswer(response: { answers: string[]; method?: QuestionSubmissionMethod }): void {
    this.answerCallback(response);
  }

  // ── State mutation ────────────────────────────────────────────────

  gotoTab(target: number): void {
    const total = this.totalTabs();
    if (total <= 0) return;

    const wrapped = ((target % total) + total) % total;
    if (wrapped === this.currentTab) return;

    this.currentTab = wrapped;
    this.editingOther = false;
    this.reviewMessage = undefined;
    if (this.isSubmitTab()) this.submitActionIdx = 0;
  }

  moveQuestionCursor(delta: number): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const total = this.displayOptions(questionIdx).length;
    if (total <= 0) return;

    this.cursors[questionIdx] = (this.currentCursor() + delta + total) % total;
    this.reviewMessage = undefined;
  }

  activateQuestionOption(optionIdx: number, method: QuestionSubmissionMethod): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    this.cursors[questionIdx] = optionIdx;
    this.editingOther = false;
    this.reviewMessage = undefined;

    if (this.isOtherOption(questionIdx, optionIdx)) {
      this.enterOtherInput(questionIdx);
      return;
    }

    if (question.multi_select) {
      const set = this.multiSelections[questionIdx];
      if (set === undefined) return;
      if (set.has(optionIdx)) set.delete(optionIdx);
      else set.add(optionIdx);
      this.lastAnswerMethod = method;
      this.updateAnswer(questionIdx);
      return;
    }

    this.singleSelections[questionIdx] = optionIdx;
    this.committedOtherValues[questionIdx] = undefined;
    this.lastAnswerMethod = method;
    this.updateAnswer(questionIdx);
    this.advanceAfterSingleSelect(questionIdx);
  }

  executeSubmitAction(actionIdx: number, method: QuestionSubmissionMethod): void {
    if (actionIdx === 1) {
      this.onAnswer({ answers: [] });
      return;
    }

    this.reviewMessage = undefined;
    this.emitAnswers(method);
  }

  syncOtherDraft(questionIdx: number): void {
    this.otherDrafts[questionIdx] = this.otherInput.getValue();
  }

  private enterOtherInput(questionIdx: number): void {
    this.cursors[questionIdx] = this.otherOptionIndex(questionIdx);
    this.editingOther = true;
    this.otherInput.setValue(this.otherDraftValue(questionIdx));
    this.reviewMessage = undefined;
  }

  private commitOtherInput(rawValue: string | undefined, method: QuestionSubmissionMethod): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    const value = (rawValue ?? this.otherInput.getValue()).trim();
    if (value.length === 0) return;

    this.otherInput.setValue(value);
    this.otherDrafts[questionIdx] = value;
    this.committedOtherValues[questionIdx] = value;

    if (question.multi_select) {
      this.multiSelections[questionIdx]?.add(this.otherOptionIndex(questionIdx));
    } else {
      this.singleSelections[questionIdx] = this.otherOptionIndex(questionIdx);
    }

    this.lastAnswerMethod = method;
    this.updateAnswer(questionIdx);
    this.editingOther = false;
    this.reviewMessage = undefined;

    if (!question.multi_select) this.advanceAfterSingleSelect(questionIdx);
  }

  private advanceAfterSingleSelect(questionIdx: number): void {
    const next = this.findNextUnansweredAfter(questionIdx);
    this.currentTab = next ?? this.submitTabIndex();
    this.reviewMessage = undefined;
    if (this.isSubmitTab()) this.submitActionIdx = 0;
  }

  private findNextUnansweredAfter(fromIdx: number): number | null {
    const total = this.request.data.questions.length;
    for (let idx = fromIdx + 1; idx < total; idx++) {
      if (!this.isAnswered(idx)) return idx;
    }
    return null;
  }

  private updateAnswer(questionIdx: number): void {
    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    if (question.multi_select) {
      const labels: string[] = [];
      const set = this.multiSelections[questionIdx] ?? new Set<number>();
      const otherIdx = this.otherOptionIndex(questionIdx);
      for (let i = 0; i < question.options.length; i++) {
        if (!set.has(i)) continue;
        const label = question.options[i]?.label;
        if (label !== undefined && label.length > 0) labels.push(label);
      }
      const otherText = this.committedOtherValues[questionIdx];
      if (set.has(otherIdx) && otherText !== undefined && otherText.length > 0) {
        labels.push(otherText);
      }
      this.answers[questionIdx] = labels.length > 0 ? labels.join(', ') : undefined;
      return;
    }

    const selection = this.singleSelections[questionIdx];
    if (selection === undefined) {
      this.answers[questionIdx] = undefined;
      return;
    }

    if (this.isOtherOption(questionIdx, selection)) {
      const otherText = this.committedOtherValues[questionIdx];
      this.answers[questionIdx] =
        otherText !== undefined && otherText.length > 0 ? otherText : undefined;
      return;
    }

    const label = question.options[selection]?.label;
    this.answers[questionIdx] = label !== undefined && label.length > 0 ? label : undefined;
  }

  private emitAnswers(method: QuestionSubmissionMethod): void {
    const out: string[] = [];
    for (let i = 0; i < this.answers.length; i++) {
      const answer = this.answers[i];
      if (answer !== undefined && answer.length > 0) out[i] = answer;
    }
    this.onAnswer({ answers: out, method: this.lastAnswerMethod ?? method });
  }

  // ── Render ────────────────────────────────────────────────────────

  override render(width: number): string[] {
    return renderQuestionDialog(this, width);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  totalTabs(): number {
    return this.request.data.questions.length + 1;
  }

  submitTabIndex(): number {
    return this.request.data.questions.length;
  }

  isSubmitTab(): boolean {
    return this.currentTab === this.submitTabIndex();
  }

  isEditingOther(): boolean {
    return this.editingOther && !this.isSubmitTab();
  }

  currentQuestionIndex(): number | undefined {
    return this.isSubmitTab() ? undefined : this.currentTab;
  }

  currentCursor(): number {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return 0;
    return this.cursors[questionIdx] ?? 0;
  }

  displayOptions(questionIdx: number): DisplayOption[] {
    return buildDisplayOptions(this.request.data.questions[questionIdx]);
  }

  otherOptionIndex(questionIdx: number): number {
    return otherOptionIndexForQuestion(this.request.data.questions[questionIdx]);
  }

  isOtherOption(questionIdx: number, optionIdx: number): boolean {
    return isOtherOptionForQuestion(this.request.data.questions[questionIdx], optionIdx);
  }

  otherDraftValue(questionIdx: number): string {
    return (this.otherDrafts[questionIdx] ?? this.committedOtherValues[questionIdx]) ?? '';
  }

  isAnswered(questionIdx: number): boolean {
    const answer = this.answers[questionIdx];
    return answer !== undefined && answer.length > 0;
  }

  hasUnansweredQuestions(): boolean {
    for (let i = 0; i < this.request.data.questions.length; i++) {
      if (!this.isAnswered(i)) return true;
    }
    return false;
  }

  isMultiSelect(questionIdx: number): boolean {
    return this.request.data.questions[questionIdx]?.multi_select === true;
  }

  override invalidate(): void {
    super.invalidate();
    this.otherInput.invalidate();
  }
}
