import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import type { Agent } from '../agent';
import type { GoalSnapshot } from '../agent/goal';
import type { UltraworkRun } from '@superliora/protocol';
import {
  clipClassifierText,
  clampConfidence,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  validateStringField,
} from './llm-classifier-utils';

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
  if (run === null) return false;
  if (run.status === 'blocked') return true;
  // Soft / mirrored interrupts may record a reason while status is still running.
  const reason = context.ultraworkInterruptReason?.trim();
  if (
    reason !== undefined &&
    reason.length > 0 &&
    (run.status === 'running' || run.status === 'blocked')
  ) {
    return true;
  }
  // Soft mid-run: still-running Ultrawork with unfinished WorkGraph nodes is
  // resumable even when interruptReason was not mirrored onto the agent yet.
  if (run.status === 'running' && hasPendingWorkGraphNodes(run)) {
    return true;
  }
  return false;
}

function hasPendingWorkGraphNodes(run: UltraworkRun): boolean {
  const nodes = run.workGraph?.nodes;
  if (nodes === undefined || nodes.length === 0) return false;
  return nodes.some((node) => node.status !== 'done' && node.status !== 'cancelled');
}

/**
 * Deterministic short-phrase resume detector (no LLM).
 * Used before the classifier and when the provider is unavailable so clear
 * "continue / 재개 / 继续" messages still recover blocked work.
 */
export function matchExplicitResumePhrase(
  text: string,
): InterruptedWorkResumeIntent | undefined {
  const trimmed = text.trim();
  // Exact short phrases stay under ~96; resume+steering may run longer (cap 160 below).
  if (trimmed.length === 0 || trimmed.length > 160) return undefined;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[!?.。！？…]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  const exact = new Set([
    'continue',
    'go on',
    'keep going',
    'keep going please',
    'please continue',
    'please resume',
    'resume',
    'resume please',
    'retry',
    'proceed',
    'go ahead',
    '계속',
    '계속해',
    '계속해줘',
    '계속 해',
    '계속 해줘',
    '계속진행',
    '계속진행하라',
    '계속 진행',
    '계속 진행하라',
    '재개',
    '재개해',
    '재개해줘',
    '이어서',
    '이어서 해',
    '이어서 해줘',
    '이어가',
    '이어가줘',
    '이어서 진행',
    '이어서 진행해',
    '이어서 진행해줘',
    '계속 진행해줘',
    '다시 이어서',
    'pick up where you left off',
    'from where you left off',
    'pick up where we left off',
    'from where we left off',
    'from where we left off please',
    'where we left off',
    'carry on',
    'carry on please',
    'go on please',
    'keep at it',
    'keep at it please',
    'keep working',
    'continue working',
    'continue the work',
    'resume work',
    'resume the work',
    'pick it back up',
    '이어서 해 주세요',
    '이어서 해주세요',
    '이어서 해 주세요.',
    '이어서 작업해줘',
    '이어서 작업해 주세요',
    '계속 작업해줘',
    '계속 작업해 주세요',
    '계속 해주세요',
    '계속해 주세요',
    '계속 해 주세요',
    '다시 이어서 해줘',
    '다시 이어서',
    '다시 시작해',
    '다시 시작',
    '继续',
    '继续吧',
    '请继续',
    '続けて',
    '再開',
    '続けてください',
  ]);
  if (exact.has(normalized)) {
    return {
      shouldResume: true,
      confidence: 0.95,
      reason: 'Explicit short resume phrase',
    };
  }

  // Light English variants with optional please / trailing period already stripped.
  if (/^(please\s+)?(continue|resume|retry|proceed|go on|keep going|go ahead|carry on|keep at it|keep working|continue working|continue the work|resume work|resume the work|pick it back up)(\s+please)?$/i.test(normalized)) {
    return {
      shouldResume: true,
      confidence: 0.92,
      reason: 'Explicit short resume phrase',
    };
  }

  // Resume + short steering: "continue, fix the auth tests" / "이어서 해줘. 테스트도 돌려".
  // Keep this conservative: message must start with a resume verb/phrase and stay short.
  if (trimmed.length <= 160 && matchResumePrefixWithSteering(normalized)) {
    return {
      shouldResume: true,
      confidence: 0.9,
      reason: 'Explicit resume phrase with steering',
    };
  }

  return undefined;
}

/**
 * True when the normalized message begins with a resume command and then
 * continues with steering (comma/colon/dash/space + more text).
 * Rejects long free-form requests that merely contain "continue" mid-sentence.
 */
function matchResumePrefixWithSteering(normalized: string): boolean {
  // English prefixes (word-boundary safe)
  const en =
    /^(please\s+)?(continue|resume|retry|proceed|go on|keep going|go ahead|carry on|keep at it|keep working|continue working|continue the work|resume work|resume the work|pick it back up)\b([,.:;–—-]|\s+)/i;
  if (en.test(normalized)) {
    // Require residual steering content after the prefix
    const rest = normalized.replace(en, '').trim();
    return rest.length >= 2 && !/^(please)$/i.test(rest);
  }

  // Korean short prefixes that commonly lead steering.
  // No \b after Hangul — JS word boundaries only fire on [A-Za-z0-9_].
  const ko =
    /^(이어서(\s*(해\s*줘|해\s*주세요|해주세요|작업해\s*줘|작업해\s*주세요|진행해?줘?|진행))?|계속(\s*(해\s*줘|해\s*주세요|해주세요|작업해\s*줘|작업해\s*주세요|진행해?줘?|진행하라|진행|해))?|재개(\s*(해\s*줘|해))?|다시\s*(이어서|시작해?))/u;
  if (ko.test(normalized)) {
    const rest = normalized.replace(ko, '').trim().replace(/^[,.。，、:：\-–—]+\s*/u, '');
    return rest.length >= 2;
  }

  // Chinese / Japanese short prefixes (no \b — CJK is non-word for JS \b).
  const cjk = /^(继续(吧)?|请继续|続けて(ください)?|再開)/u;
  if (cjk.test(normalized)) {
    const rest = normalized.replace(cjk, '').trim().replace(/^[,.。，、:：\-–—]+\s*/u, '');
    return rest.length >= 2;
  }

  return false;
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

  const explicit = matchExplicitResumePhrase(text);
  if (explicit !== undefined) return explicit;

  const clipped = clipClassifierText(text);

  try {
    const response = await deps.generate(
      deps.provider,
      RESUME_INTENT_SYSTEM,
      [],
      [createUserMessage(buildDetectionUserPrompt(clipped, input.context))],
      undefined,
      { signal: createClassifierTimeoutSignal(undefined, input.signal) },
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
  const interruptReason = context.ultraworkInterruptReason?.trim();
  if (
    run !== null &&
    (run.status === 'blocked' ||
      (run.status === 'running' && interruptReason !== undefined && interruptReason.length > 0))
  ) {
    lines.push(
      '',
      'Interrupted Ultrawork run:',
      `- objective: ${run.objective}`,
      `- stage: ${run.stage}`,
      `- status: ${run.status}`,
      interruptReason === undefined || interruptReason.length === 0
        ? ''
        : `- interrupt reason: ${interruptReason}`,
    );
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

function parseDetectionResponse(text: string): InterruptedWorkResumeIntent | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const shouldResume = record['should_resume'];
  const confidence = clampConfidence(record['confidence']);
  const reason = validateStringField(record['reason']);
  if (typeof shouldResume !== 'boolean') return undefined;
  if (confidence === undefined) return undefined;
  if (reason === undefined) return undefined;
  return { shouldResume, confidence, reason };
}
