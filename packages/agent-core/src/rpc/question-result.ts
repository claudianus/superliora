import type { QuestionAnswers, QuestionResponse, QuestionResult } from './sdk-api';

export function isQuestionResponse(
  result: Exclude<QuestionResult, null>,
): result is QuestionResponse {
  if (typeof result !== 'object' || result === null) return false;
  if (!Object.hasOwn(result, 'answers')) return false;
  const answers = (result as { readonly answers?: unknown }).answers;
  return typeof answers === 'object' && answers !== null && !Array.isArray(answers);
}

export function normalizeQuestionAnswers(result: QuestionResult): QuestionAnswers | undefined {
  if (result === null) return undefined;
  if (isQuestionResponse(result)) return result.answers;
  return result;
}
