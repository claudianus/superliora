import type { PendingQuestion } from '#/tui/reverse-rpc/types';

import {
  DEFAULT_OTHER_LABEL,
  type DisplayOption,
} from './question-dialog-constants';

export function buildDisplayOptions(
  question: PendingQuestion['data']['questions'][number] | undefined,
): DisplayOption[] {
  if (question === undefined) return [];

  return [
    ...question.options.map((option) => ({
      label: option.label,
      description: option.description,
      kind: 'preset' as const,
    })),
    {
      label: question.other_label?.length ? question.other_label : DEFAULT_OTHER_LABEL,
      description: question.other_description?.length ? question.other_description : undefined,
      kind: 'other' as const,
    },
  ];
}

export function otherOptionIndex(
  question: PendingQuestion['data']['questions'][number] | undefined,
): number {
  return question?.options.length ?? 0;
}

export function isOtherOption(
  question: PendingQuestion['data']['questions'][number] | undefined,
  optionIdx: number,
): boolean {
  return optionIdx === otherOptionIndex(question);
}
