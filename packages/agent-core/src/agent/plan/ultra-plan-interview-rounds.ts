/**
 * Pure interview round assembly helpers for Ultra Plan.
 */

import type {
  InterviewAnswerOrigin,
  InterviewRound,
  InterviewState,
} from './ultra-plan-mode';

export function formatInterviewAnswerText(
  answers: Record<string, string | true>,
): string {
  return Object.entries(answers)
    .map(([key, value]) => `${key}: ${value === true ? 'true' : value}`)
    .join('\n');
}

export function formatInterviewQuestionText(
  questions: ReadonlyArray<{ readonly question: string; readonly header?: string }>,
): string {
  return questions
    .map((q) =>
      q.header === undefined || q.header.length === 0
        ? q.question
        : `${q.header}: ${q.question}`,
    )
    .join('\n');
}

export function appendInterviewRoundState(
  interviewState: InterviewState,
  question: string,
  userResponse: string,
  origin: InterviewAnswerOrigin = 'user',
  now = Date.now(),
): InterviewState {
  const round: InterviewRound = {
    roundNumber: interviewState.rounds.length + 1,
    question,
    userResponse,
    timestamp: now,
    origin,
  };
  const consecutiveNonUserAnswers =
    origin === 'user' ? 0 : interviewState.consecutiveNonUserAnswers + 1;
  return {
    ...interviewState,
    rounds: [...interviewState.rounds, round],
    consecutiveNonUserAnswers,
    // A new round changes the evidence — invalidate the LLM cache and
    // unlock monotonic ready so the gate is re-evaluated fairly.
    lastScoredEvidenceHash: undefined,
    cachedLlmResult: undefined,
    monotonicReadyLocked: false,
  };
}
