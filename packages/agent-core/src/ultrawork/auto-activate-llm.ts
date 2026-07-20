import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import type { Agent } from '../agent';
import {
  clipClassifierText,
  clampConfidence,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  validateStringField,
} from './llm-classifier-utils';

export interface UltraworkAutoActivationIntent {
  readonly shouldActivate: boolean;
  readonly confidence: number;
  readonly reason: string;
}

export interface UltraworkAutoActivationLlmDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

const MIN_CONFIDENCE = 0.65;

const AUTO_ACTIVATE_SYSTEM = `You decide whether a coding-agent user prompt should start Ultrawork, SuperLiora's multi-stage autonomous workflow.

Ultrawork runs this ordered spine:
UltraResearch prelude -> UltraPlan interview -> verifiable UltraGoal -> Swarm decision -> Integrate -> Verify -> Learn.

Return ONLY compact JSON:
{"should_activate":true,"confidence":0.88,"reason":"short English explanation"}

Activate (should_activate=true) when the dominant intent is to execute substantial work that benefits from that orchestrated workflow, including:
- multi-step product work spanning research/plan/implement/verify
- multi-lane or multi-file features, refactors, migrations, architecture changes
- end-to-end goals where acceptance criteria and evidence matter
- explicit requests to run Ultrawork / UltraPlan / UltraGoal / UltraResearch / UltraSwarm (or clearly equivalent branded workflow names in any language)

Do NOT activate when:
- the user is only asking what Ultrawork/Ultra* is, how it works, or similar meta questions
- the user opts out of Ultrawork/Ultra* ("don't use ultrawork", "without ultraplan", etc.)
- the request is an open-ended or infinite improvement/development loop with no terminal completion state (e.g. "무한 자가 개선 루프", "무제한 개발 루프", "keep improving forever", "endless loop of improvements"); those run as ordinary goal-driven iteration, not a bounded Ultrawork run
- the request is a simple Q&A, explanation, inspection, rename, typo/copy fix, or single small local edit
- a normal one-shot agent turn is enough and the full workflow would be overhead
- the message is empty, pure emoji, or otherwise non-actionable

Rules:
- Judge meaning, not fixed keywords. Any language is fine.
- If the user mixes a question with a build request, follow the dominant actionable intent.
- confidence: 0.0-1.0. Stay below 0.65 when ambiguous.
- reason: one short English sentence for logs.`;

/**
 * Deterministic pre-filter: open-ended or infinite improvement loops have no
 * terminal completion state, so they must not enter Ultrawork's bounded
 * verifiable-goal spine; they run as ordinary goal-driven iteration instead.
 *
 * Requires BOTH an unbounded marker and an improvement/loop marker in close
 * proximity so that bug reports such as "fix the infinite loop in the parser"
 * or feature work such as "무한 스크롤 개발" still classify normally.
 */
const OPEN_ENDED_LOOP_PATTERNS: readonly RegExp[] = [
  /(무한|끝없|endless|infinite|perpetual|never[- ]?ending).{0,30}(루프|loop|반복|개선|향상|improv|enhanc)/i,
  /(루프|loop|반복|개선|향상|improv|enhanc).{0,30}(무한|끝없|endless|infinite|perpetual|never[- ]?ending)/i,
  /무제한.{0,15}(개발|개선|루프|반복)/i,
  /keep\s+(?:on\s+)?improving\b.{0,40}(?:forever|endlessly|indefinitely)/i,
  /(continuous|perpetual)(?:ly)?\s+(?:self[- ]?)?improv/i,
];

const OPEN_ENDED_LOOP_BUG_CONTEXT =
  /버그|오류|에러|디버깅|고쳐\s*줘|수정해|fix\b|debug|bug\b|crash|hang\b|걸려\s*있|멈춰/i;

export function isOpenEndedImprovementLoop(text: string): boolean {
  if (OPEN_ENDED_LOOP_BUG_CONTEXT.test(text)) return false;
  return OPEN_ENDED_LOOP_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * LLM classifier for plain-prompt Ultrawork auto-activation.
 * Fail-closed: callers must treat undefined / low confidence as "do not activate".
 */
export async function detectUltraworkAutoActivationWithLlm(
  deps: UltraworkAutoActivationLlmDeps,
  input: {
    readonly text: string;
    readonly signal?: AbortSignal;
  },
): Promise<UltraworkAutoActivationIntent | undefined> {
  const text = input.text.trim();
  if (text.length === 0) return undefined;

  // Open-ended improvement loops never fit the bounded verifiable-goal spine;
  // decline deterministically without spending an LLM classifier call.
  if (isOpenEndedImprovementLoop(text)) {
    return {
      shouldActivate: false,
      confidence: 1,
      reason: 'Open-ended improvement loop; runs as ordinary goal-driven iteration',
    };
  }

  const clipped = clipClassifierText(text);

  try {
    const response = await deps.generate(
      deps.provider,
      AUTO_ACTIVATE_SYSTEM,
      [],
      [createUserMessage(buildDetectionUserPrompt(clipped))],
      undefined,
      { signal: createClassifierTimeoutSignal(undefined, input.signal) },
    );
    return parseDetectionResponse(extractTextFromGenerateResponse(response));
  } catch {
    return undefined;
  }
}

export function shouldActOnUltraworkAutoActivation(
  intent: UltraworkAutoActivationIntent | undefined,
): intent is UltraworkAutoActivationIntent {
  return intent !== undefined && intent.shouldActivate && intent.confidence >= MIN_CONFIDENCE;
}

function buildDetectionUserPrompt(text: string): string {
  return [
    'Classify whether this user message should start Ultrawork.',
    '',
    'User message:',
    text,
  ].join('\n');
}

function parseDetectionResponse(text: string): UltraworkAutoActivationIntent | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const shouldActivate = record['should_activate'];
  const confidence = clampConfidence(record['confidence']);
  const reason = validateStringField(record['reason']);
  if (typeof shouldActivate !== 'boolean') return undefined;
  if (confidence === undefined) return undefined;
  if (reason === undefined) return undefined;
  return { shouldActivate, confidence, reason };
}
