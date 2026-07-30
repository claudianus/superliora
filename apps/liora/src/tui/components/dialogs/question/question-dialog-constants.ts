export const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const MAX_BODY_LINES = 12;
export const DEFAULT_OTHER_LABEL = 'Other';
export const NOT_ANSWERED_LABEL = 'Not answered';
export const REVIEW_TITLE = 'Review your answer before submit';
export const SUBMIT_PROMPT = 'Ready to submit your answers?';
export const UNANSWERED_WARNING = 'Some questions are still unanswered.';
export const SUBMIT_ACTIONS = ['Submit', 'Cancel'] as const;

export interface DisplayOption {
  readonly label: string;
  readonly description?: string | undefined;
  readonly kind: 'preset' | 'other';
}
