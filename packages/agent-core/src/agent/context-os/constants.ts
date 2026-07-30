import type { ContextOSRenderProfile } from './types';

export const MAX_CONTEXT_OS_PAGES = 16;
export const MAX_SELECTED_PAGES = 2;
export const MAX_INJECTION_CHARS = 3_500;
export const MAX_LIST_ITEMS = 5;
export const MAX_FILE_HINTS = 8;
export const MAX_RAW_REFS_PER_PAGE = 4;
export const MAX_ITEM_CHARS = 240;
export const MAX_GOAL_CHARS = 360;
export const REDACTED_RECALLED_INSTRUCTION = '[redacted recalled prompt-control instruction]';

export const TOKEN_STOPWORDS = new Set([
  'about',
  'active',
  'after',
  'and',
  'are',
  'changed',
  'continue',
  'for',
  'from',
  'how',
  'next',
  'state',
  'task',
  'the',
  'this',
  'what',
  'which',
  'work',
  'with',
  'you',
]);

export const RENDER_PROFILES: readonly ContextOSRenderProfile[] = [
  {
    name: 'full',
    maxListItems: MAX_LIST_ITEMS,
    maxFileHints: MAX_FILE_HINTS,
    maxItemChars: MAX_ITEM_CHARS,
    maxGoalChars: MAX_GOAL_CHARS,
    includeRawRefs: true,
  },
  {
    name: 'compact',
    maxListItems: 2,
    maxFileHints: 3,
    maxItemChars: 140,
    maxGoalChars: 220,
    includeRawRefs: false,
  },
  {
    name: 'minimal',
    maxListItems: 1,
    maxFileHints: 2,
    maxItemChars: 90,
    maxGoalChars: 140,
    includeRawRefs: false,
  },
];
