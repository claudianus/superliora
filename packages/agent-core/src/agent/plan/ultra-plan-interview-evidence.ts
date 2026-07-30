/**
 * Interview evidence text assembly for Ultra Plan ambiguity scoring.
 */

import { extractText } from '@superliora/kosong';

import type { Agent } from '..';
import { isRealUserPromptOrigin } from '../context';
import type { InterviewState } from './ultra-plan-types';

export function buildInterviewEvidenceText(
  agent: Agent,
  interviewState: InterviewState,
): string {
  return [
    interviewState.initialContext,
    ...recentUserPromptTexts(agent, interviewState),
    ...interviewState.rounds.map((round) => round.userResponse),
  ].join('\n');
}

export function recentUserPromptTexts(agent: Agent, interviewState: InterviewState): string[] {
  const startedAt = interviewState.startedAtTimestamp ?? 0;
  return (agent.context?.history ?? [])
    .filter(
      (message) =>
        message.role === 'user' &&
        isRealUserPromptOrigin(message.origin) &&
        ((message as { timestamp?: number }).timestamp ?? 0) >= startedAt,
    )
    .slice(-3)
    .map((message) => extractText(message, '\n').trim())
    .filter((text) => text.length > 0);
}

export function emitUltraPlanProgress(
  onProgress: ((text: string) => void) | undefined,
  text: string,
): void {
  if (onProgress === undefined) return;
  try {
    onProgress(text);
  } catch {
    // Progress is best-effort; do not let a listener failure break the engine.
  }
}
