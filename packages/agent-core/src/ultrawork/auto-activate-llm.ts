import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import type { Agent } from '../agent';

export interface UltraworkAutoActivationIntent {
  readonly shouldActivate: boolean;
  readonly confidence: number;
  readonly reason: string;
}

export interface UltraworkAutoActivationLlmDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

const MAX_USER_TEXT_CHARS = 2_000;
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
- the request is a simple Q&A, explanation, inspection, rename, typo/copy fix, or single small local edit
- a normal one-shot agent turn is enough and the full workflow would be overhead
- the message is empty, pure emoji, or otherwise non-actionable

Rules:
- Judge meaning, not fixed keywords. Any language is fine.
- If the user mixes a question with a build request, follow the dominant actionable intent.
- confidence: 0.0-1.0. Stay below 0.65 when ambiguous.
- reason: one short English sentence for logs.`;

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

  const clipped =
    text.length <= MAX_USER_TEXT_CHARS ? text : `${text.slice(0, MAX_USER_TEXT_CHARS)}…`;

  try {
    const response = await deps.generate(
      deps.provider,
      AUTO_ACTIVATE_SYSTEM,
      [],
      [createUserMessage(buildDetectionUserPrompt(clipped))],
      undefined,
      { signal: input.signal },
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
  const json = extractJsonObject(text);
  if (json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const shouldActivate = record['should_activate'];
  const confidence = record['confidence'];
  const reason = record['reason'];
  if (typeof shouldActivate !== 'boolean') return undefined;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  if (typeof reason !== 'string' || reason.trim().length === 0) return undefined;
  return {
    shouldActivate,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason: reason.trim(),
  };
}

function extractTextFromGenerateResponse(response: unknown): string {
  const msg = response as {
    message?: {
      content?: ReadonlyArray<{ type?: string; text?: string }>;
    };
  };
  const parts = msg.message?.content ?? [];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
  }
  return '';
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);
  return null;
}
