import { decodeKittyPrintable, Key, matchesKey } from '#/tui/renderer';

import type { Input } from '../shared/input';
import { NUMBER_KEYS, SUBMIT_ACTIONS } from './question-dialog-constants';
import type { QuestionSubmissionMethod } from '#/tui/reverse-rpc/types';

export interface QuestionDialogInputHost {
  readonly otherInput: Input;
  editingOther: boolean;
  currentTab: number;
  submitActionIdx: number;
  reviewMessage: string | undefined;

  isSubmitTab(): boolean;
  isEditingOther(): boolean;
  currentQuestionIndex(): number | undefined;
  currentCursor(): number;
  totalTabs(): number;
  displayOptions(questionIdx: number): { readonly label: string }[];
  isMultiSelect(questionIdx: number): boolean;
  gotoTab(target: number): void;
  moveQuestionCursor(delta: number): void;
  activateQuestionOption(optionIdx: number, method: QuestionSubmissionMethod): void;
  executeSubmitAction(actionIdx: number, method: QuestionSubmissionMethod): void;
  syncOtherDraft(questionIdx: number): void;
  onToggleToolOutput?: (() => void) | undefined;
  onAnswer(response: { answers: string[]; method?: QuestionSubmissionMethod }): void;
}

export function handleQuestionDialogInput(host: QuestionDialogInputHost, data: string): void {
  if (matchesKey(data, Key.escape)) {
    host.onAnswer({ answers: [] });
    return;
  }

  if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
    host.onAnswer({ answers: [] });
    return;
  }

  if (matchesKey(data, Key.ctrl('o'))) {
    host.onToggleToolOutput?.();
    return;
  }

  if (host.isEditingOther()) {
    handleOtherInput(host, data);
    return;
  }

  if (host.isSubmitTab()) {
    handleSubmitInput(host, data);
    return;
  }

  const questionIdx = host.currentQuestionIndex();
  if (questionIdx === undefined) return;
  const optionCount = host.displayOptions(questionIdx).length;
  if (optionCount === 0) return;

  if (matchesKey(data, Key.up)) {
    host.moveQuestionCursor(-1);
    return;
  }
  if (matchesKey(data, Key.down)) {
    host.moveQuestionCursor(1);
    return;
  }

  if (matchesKey(data, Key.left)) {
    host.gotoTab(host.currentTab - 1);
    return;
  }
  if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
    host.gotoTab(host.currentTab + 1);
    return;
  }

  if (matchesKey(data, Key.enter)) {
    host.activateQuestionOption(host.currentCursor(), 'enter');
    return;
  }

  const printable = decodeKittyPrintable(data) ?? data;
  const numIdx = NUMBER_KEYS.indexOf(printable);
  if (numIdx >= 0 && numIdx < optionCount) {
    host.activateQuestionOption(numIdx, 'number_key');
    return;
  }

  if ((printable === ' ' || matchesKey(data, Key.space)) && host.isMultiSelect(questionIdx)) {
    host.activateQuestionOption(host.currentCursor(), 'space');
  }
}

function handleOtherInput(host: QuestionDialogInputHost, data: string): void {
  const questionIdx = host.currentQuestionIndex();
  if (questionIdx === undefined) return;

  if (matchesKey(data, Key.tab)) {
    host.syncOtherDraft(questionIdx);
    host.editingOther = false;
    host.gotoTab(host.currentTab + 1);
    return;
  }
  if (matchesKey(data, Key.up)) {
    host.syncOtherDraft(questionIdx);
    host.editingOther = false;
    host.moveQuestionCursor(-1);
    return;
  }
  if (matchesKey(data, Key.down)) {
    host.syncOtherDraft(questionIdx);
    host.editingOther = false;
    host.moveQuestionCursor(1);
    return;
  }

  host.otherInput.handleInput(data);
  host.syncOtherDraft(questionIdx);
  host.reviewMessage = undefined;
}

function handleSubmitInput(host: QuestionDialogInputHost, data: string): void {
  if (matchesKey(data, Key.up)) {
    host.submitActionIdx =
      (host.submitActionIdx - 1 + SUBMIT_ACTIONS.length) % SUBMIT_ACTIONS.length;
    host.reviewMessage = undefined;
    return;
  }
  if (matchesKey(data, Key.down)) {
    host.submitActionIdx = (host.submitActionIdx + 1) % SUBMIT_ACTIONS.length;
    host.reviewMessage = undefined;
    return;
  }

  if (matchesKey(data, Key.left)) {
    host.gotoTab(host.currentTab - 1);
    return;
  }
  if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
    host.gotoTab(host.currentTab + 1);
    return;
  }

  if (matchesKey(data, Key.enter)) {
    host.executeSubmitAction(host.submitActionIdx, 'enter');
    return;
  }

  const printable = decodeKittyPrintable(data) ?? data;
  if (printable === '1') {
    host.submitActionIdx = 0;
    host.executeSubmitAction(0, 'number_key');
    return;
  }
  if (printable === '2') {
    host.submitActionIdx = 1;
    host.executeSubmitAction(1, 'number_key');
  }
}
