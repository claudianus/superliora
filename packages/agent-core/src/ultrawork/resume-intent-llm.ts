import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import type { Agent } from '../agent';
import type { GoalSnapshot } from '../agent/goal';
import type { UltraworkRun } from '@superliora/protocol';

export const CONTINUE_GOAL_INPUT =
  'Continue from where you left off. Resume the active goal without restarting earlier Ultrawork stages or redoing completed work.';

export interface InterruptedWorkResumeContext {
  readonly goal: GoalSnapshot | null;
  readonly ultraworkRun: UltraworkRun | null;
  readonly ultraworkInterruptReason?: string;
}

export interface InterruptedWorkResumeIntent {
  readonly shouldResume: boolean;
  readonly confidence: number;
  readonly reason: string;
}

export interface InterruptedWorkResumeLlmDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

const MAX_USER_TEXT_CHARS = 2_000;
const MIN_CONFIDENCE = 0.6;

const RESUME_INTENT_SYSTEM = `You classify whether a user message means "resume the interrupted autonomous work" for a coding agent.

Return ONLY compact JSON:
{"should_resume":true,"confidence":0.92,"reason":"short explanation"}

Rules:
- should_resume: true when the user wants to continue, resume, retry, or keep going on the SAME interrupted task/goal/run — in any language or phrasing.
- should_resume: false when the user starts a new unrelated task, changes topic, asks an unrelated question, cancels, or gives materially new instructions that replace the paused work.
- Treat short continuations ("continue", "go on", "keep going", "계속", "재개", "이어서", "继续", "続けて") as resume when they clearly refer to the interrupted work.
- If the message mixes resume intent with a brand-new objective, prefer should_resume=false unless the dominant intent is clearly to continue the existing work.
- confidence: 0.0-1.0. Use below 0.6 when ambiguous.
- reason: one short English sentence for logs.`;

export function hasInterruptedWorkResumeContext(
  context: InterruptedWorkResumeContext,
): boolean {
  const goal = context.goal;
  if (goal?.status === 'paused' || goal?.status === 'blocked') return true;
  const run = context.ultraworkRun;
  return run !== null && run.status === 'blocked';
}

export async function detectInterruptedWorkResumeIntentWithLlm(
  deps: InterruptedWorkResumeLlmDeps,
  input: {
    readonly text: string;
    readonly context: InterruptedWorkResumeContext;
    readonly signal?: AbortSignal;
  },
): Promise<InterruptedWorkResumeIntent | undefined> {
  const text = input.text.trim();
  if (text.length === 0) return undefined;

  const clipped =
    text.length <= MAX_USER_TEXT_CHARS ? text : `${text.slice(0, MAX_USER_TEXT_CHARS)}…`;

  try {
    const response = await deps.generate(
      deps.provider,
      RESUME_INTENT_SYSTEM,
      [],
      [createUserMessage(buildDetectionUserPrompt(clipped, input.context))],
      undefined,
      { signal: input.signal },
    );
    return parseDetectionResponse(extractTextFromGenerateResponse(response));
  } catch {
    return undefined;
  }
}

export function shouldActOnResumeIntent(
  intent: InterruptedWorkResumeIntent | undefined,
): intent is InterruptedWorkResumeIntent {
  return intent !== undefined && intent.shouldResume && intent.confidence >= MIN_CONFIDENCE;
}

function buildDetectionUserPrompt(text: string, context: InterruptedWorkResumeContext): string {
  const lines = ['Classify the user message against the interrupted work state.', '', 'User message:', text];
  const goal = context.goal;
  if (goal !== null && (goal.status === 'paused' || goal.status === 'blocked')) {
    lines.push(
      '',
      'Paused goal:',
      `- status: ${goal.status}`,
      `- objective: ${goal.objective}`,
      goal.terminalReason === undefined ? '' : `- pause reason: ${goal.terminalReason}`,
    );
  }
  const run = context.ultraworkRun;
  if (run !== null && run.status === 'blocked') {
    lines.push(
      '',
      'Interrupted Ultrawork run:',
      `- objective: ${run.objective}`,
      `- stage: ${run.stage}`,
      context.ultraworkInterruptReason === undefined
        ? ''
        : `- interrupt reason: ${context.ultraworkInterruptReason}`,
    );
  }
  return lines.filter((line) => line.length > 0).join('\n');
}


function parseDetectionResponse(text: string): InterruptedWorkResumeIntent | undefined {
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
  const shouldResume = record['should_resume'];
  const confidence = record['confidence'];
  const reason = record['reason'];
  if (typeof shouldResume !== 'boolean') return undefined;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  if (typeof reason !== 'string' || reason.trim().length === 0) return undefined;
  return {
    shouldResume,
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
