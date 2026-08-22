/**
 * Mid-turn steer envelope. The model must see that the user spoke while
 * work was already in flight, and must finish unfinished tasks.
 */

import type { ContentPart } from '@superliora/kosong';

import { isRealUserPromptOrigin, type PromptOrigin } from '../context';

export const INTERJECTION_NOTE = 'The user sent a message while you were working:';
export const INTERRUPT_NOTE = 'The user interrupted the previous turn:';
export const UNFINISHED_TASKS_REMINDER =
  'Finish any unfinished tasks from earlier in this turn before switching focus.';
export const UNFINISHED_PREVIOUS_TURNS_REMINDER =
  'Make sure to complete any unfinished tasks from previous turns.';
export const LARGE_STEER_THRESHOLD = 25_000;

function userQueryEnvelope(text: string): string {
  return `<user_query>\n${text}\n</user_query>`;
}

function frameSteeredUserTurn(
  note: string,
  assembled: string,
  reminder = UNFINISHED_TASKS_REMINDER,
): string {
  return `${note}\n${assembled}\n${reminder}`;
}

function truncateSteerText(text: string, limit = LARGE_STEER_THRESHOLD): string {
  if (text.length <= limit) return text;
  let end = 0;
  for (const char of text) {
    const next = end + char.length;
    if (next > limit) break;
    end = next;
  }
  return `${text.slice(0, end)}... [truncated]`;
}

export function formatSteeredUserText(text: string): string {
  return frameSteeredUserTurn(INTERJECTION_NOTE, userQueryEnvelope(truncateSteerText(text)));
}

export function formatInterruptedUserText(text: string): string {
  return frameSteeredUserTurn(
    INTERRUPT_NOTE,
    userQueryEnvelope(truncateSteerText(text)),
    UNFINISHED_PREVIOUS_TURNS_REMINDER,
  );
}

export function shouldFrameSteer(origin: PromptOrigin): boolean {
  return isRealUserPromptOrigin(origin);
}

function frameFirstTextPart(
  input: readonly ContentPart[],
  format: (text: string) => string,
): readonly ContentPart[] {
  let framed = false;
  return input.map((part) => {
    if (part.type !== 'text' || framed) return part;
    framed = true;
    return { type: 'text', text: format(part.text) };
  });
}

export function frameSteerContent(
  input: readonly ContentPart[],
  origin: PromptOrigin,
): readonly ContentPart[] {
  if (!shouldFrameSteer(origin)) return input;
  return frameFirstTextPart(input, formatSteeredUserText);
}

export function frameInterruptContent(
  input: readonly ContentPart[],
  origin: PromptOrigin,
): readonly ContentPart[] {
  if (!shouldFrameSteer(origin)) return input;
  return frameFirstTextPart(input, formatInterruptedUserText);
}
