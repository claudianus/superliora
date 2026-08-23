import {
  APIEmptyResponseError,
  APIStatusError,
  ChatProviderError,
  extractText,
  type Message,
} from '@superliora/kosong';

import { ErrorCodes, isKimiError } from '#/errors/index';
import { isAbortError } from '../../../loop/errors';
import type { CompactionPlan } from '../plan/planner';
import { extractEvidenceIdsFromText } from '../plan/quality';
import { isStatusQueryUserText, latestUserText } from '../plan/quality-helpers';
import { parseStructuredCompactionMemory } from '../memory';
import { isRealUserPromptOrigin, type ContextMessage } from '../../context/types';

const EMERGENCY_MESSAGE_SNIPPET_CHARS = 600;
/** Hard cap for the fail-open stub injected into the next turn. */
const FAIL_OPEN_STUB_MAX_CHARS = 7_500;
const FAIL_OPEN_RAW_REF_LIMIT = 8;
const RECENT_TURN_LIMIT = 30;
const RECENT_TURN_SNIPPET_CHARS = 160;
const JOB_ID_PATTERN = /job_[a-z0-9]{6,}/gi;

/**
 * When the LLM summarizer cannot run (unsupported params, 4xx model errors,
 * timeouts, transport failures, generic ChatProviderError after retries),
 * prefer a classical extractive backstop over failing the whole turn.
 * Abort/auth are excluded so the user can still fix credentials / cancel.
 *
 * Industry alignment:
 * - OpenHands condensers (LLM + non-LLM / recent-events style)
 * - Claude Code micro-compact (tool-result clearing without LLM)
 * - Emergency extractive transcript when hierarchical LLM memory fails
 */
export function shouldUseClassicalCompactionFallback(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (isKimiError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) return false;
  if (error instanceof APIEmptyResponseError) return true;
  if (error instanceof APIStatusError) {
    // 429 is normally retried; after budget exhaustion callers still may fall back.
    if (error.statusCode === 429) return true;
    if (error.statusCode >= 400 && error.statusCode < 600) return true;
  }
  // APITimeoutError / APIConnectionError extend ChatProviderError — cover
  // hung streams, connect failures, and our per-call generate deadline.
  if (error instanceof ChatProviderError) return true;
  if (error instanceof Error) {
    const msg = error.message;
    if (
      /does not support parameter|unsupported.*parameter|reasoning_effort|reasoningEffort|invalid_request|400\b|APIEmptyResponse|context.?overflow|truncated|timed?\s*out|timeout|deadline|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network|connection|terminated|UND_ERR|other side closed|premature close/i.test(
        msg,
      )
    ) {
      return true;
    }
    // TypeError from undici/fetch ("terminated", "fetch failed") is common on
    // dropped SSE bodies — treat as transport failure, not a programming bug.
    if (error.name === 'TypeError' && /fetch|network|terminated|abort/i.test(msg)) {
      return true;
    }
  }
  return false;
}

/**
 * After the compaction retry budget is exhausted, almost every remaining
 * failure should fall back to the extractive summary rather than strand the
 * session over the hard block. Only user abort and auth prompts must surface.
 */
export function shouldFallbackAfterCompactionRetries(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (isKimiError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) return false;
  return true;
}

/**
 * Deterministic compaction summary used when the LLM summarizer exhausts retries.
 *
 * Inspired by hierarchical memory systems (MemGPT, TencentDB Agent Memory) and
 * anchored-iterative compaction (Factory.ai / Zylos 2026 guidance): preserve
 * structured continuity fields and an extractive transcript so the agent can
 * resume even when the model returns think-only or empty output.
 */
export function buildEmergencyBackstopSummary(
  messages: readonly Message[],
  plan: CompactionPlan,
  instruction?: string,
): string {
  const latestUser = findLatestUserText(messages);
  const currentGoal = resolveEmergencyCurrentGoal(messages) ?? latestUser;
  const jobIds = collectJobIds(messages, latestUser);
  const archiveIds = collectArchivePointers(messages, plan);
  const nextAction = currentGoal ?? 'the pending user request.';
  const recentTurns = collectRecentUserAssistantTurns(messages);

  const rawRefLines =
    plan.rawRefs.length > 0
      ? plan.rawRefs.slice(0, FAIL_OPEN_RAW_REF_LIMIT).map((ref) => {
          const archive =
            ref.archiveId !== undefined && ref.archiveId.length > 0
              ? ` archive=${ref.archiveId}`
              : '';
          return `- ${ref.kind} messages[${String(ref.messageStart)}..${String(ref.messageEnd)}] (~${String(ref.tokens)} tokens)${archive}`;
        })
      : ['- (not captured during compaction.)'];

  const lines = [
    'current_goal:',
    `- ${currentGoal ?? 'Continue the active task from the compacted conversation state.'}`,
    'last_known_state:',
    `- Emergency extractive backstop: ${String(messages.length)} messages (${String(plan.compactedTokens)} estimated tokens) were compacted because the LLM summarizer failed.`,
    instruction !== undefined && instruction.trim().length > 0
      ? `- User compaction instruction: ${instruction.trim()}`
      : undefined,
    'job_ids:',
    ...(jobIds.length > 0 ? jobIds.map((id) => `- ${id}`) : ['- (none captured)']),
    'decisions:',
    ...collectAssistantDecisions(messages).map((item) => `- ${item}`),
    'files_touched:',
    ...(collectFilePaths(messages).length > 0
      ? collectFilePaths(messages).map((file) => `- ${file}`)
      : ['- (not captured during compaction.)']),
    'failed_attempts:',
    ...(collectFailureLines(messages).length > 0
      ? collectFailureLines(messages).map((line) => `- ${line}`)
      : ['- (not captured during compaction.)']),
    'open_questions:',
    '- Re-verify any step marked unverified below before relying on it.',
    'next_actions:',
    `- Resume from the retained recent messages and verify: ${nextAction}`,
    'archive:',
    ...(archiveIds.length > 0
      ? archiveIds.map((id) => `- [liora-archived id=${id}]`)
      : ['- (none captured)']),
    'host_browser:',
    `- ${extractHostBrowserSlot(messages)}`,
    'dest_play_path:',
    `- ${extractDestPlayPath(messages) ?? '(not captured during compaction.)'}`,
    'last_green_tests:',
    `- ${extractLastGreenTests(messages) ?? '(not captured during compaction.)'}`,
    'do_not_retry:',
    ...doNotRetryLines(messages),
    'recent_turns:',
    ...recentTurns,
    'raw_refs:',
    ...rawRefLines,
    ...collectEvidenceLines(messages),
  ].filter((line): line is string => line !== undefined);

  const stub = lines.join('\n');
  if (stub.length <= FAIL_OPEN_STUB_MAX_CHARS) return stub;
  return `${stub.slice(0, FAIL_OPEN_STUB_MAX_CHARS)}\n…[fail-open stub truncated]`;
}

function collectJobIds(messages: readonly Message[], latestUser: string | undefined): string[] {
  const haystack = [latestUser ?? '', ...messages.map((message) => extractText(message, ' '))].join(
    '\n',
  );
  return uniqueList(haystack.match(JOB_ID_PATTERN) ?? []).slice(0, 12);
}

function collectArchivePointers(
  messages: readonly Message[],
  plan: CompactionPlan,
): string[] {
  const fromPlan = plan.rawRefs
    .map((ref) => ref.archiveId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const fromMessages = extractEvidenceIdsFromText(
    messages.map((message) => extractText(message, ' ')).join('\n'),
  ).filter((id) => /^[a-f0-9]+$/i.test(id) && id.length >= 8);
  return uniqueList([...fromPlan, ...fromMessages]).slice(0, 8);
}

function findLatestUserText(messages: readonly Message[]): string | undefined {
  const text = latestUserText(messages);
  return text === undefined ? undefined : truncateChars(text, EMERGENCY_MESSAGE_SNIPPET_CHARS);
}

function resolveEmergencyCurrentGoal(messages: readonly Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as ContextMessage;
    if (message?.origin?.kind !== 'compaction_summary') continue;
    const parsed = parseStructuredCompactionMemory(extractText(message, '\n'));
    const goal = parsed.currentGoal?.trim();
    if (goal !== undefined && goal.length > 0 && !isStatusQueryUserText(goal)) {
      return truncateChars(goal, EMERGENCY_MESSAGE_SNIPPET_CHARS);
    }
  }
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (!isRealUserPromptOrigin((message as ContextMessage).origin)) continue;
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length === 0 || isStatusQueryUserText(text)) continue;
    return truncateChars(text, EMERGENCY_MESSAGE_SNIPPET_CHARS);
  }
  return undefined;
}

function collectRecentUserAssistantTurns(messages: readonly Message[]): string[] {
  const turns: string[] = [];
  for (let i = messages.length - 1; i >= 0 && turns.length < RECENT_TURN_LIMIT; i--) {
    const message = messages[i];
    if (message === undefined) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length === 0) continue;
    turns.push(`- ${message.role}: ${truncateChars(text, RECENT_TURN_SNIPPET_CHARS)}`);
  }
  if (turns.length === 0) return ['- (not captured during compaction.)'];
  return turns.toReversed();
}

function extractHostBrowserSlot(messages: readonly Message[]): string {
  const hay = messages.map((message) => extractText(message, ' ')).join('\n');
  if (/\bEINVAL\b/i.test(hay) || /host_browser=einval/i.test(hay)) return 'einval';
  if (/Browser-use runtime is not available/i.test(hay)) return 'missing';
  return 'unknown';
}

function extractDestPlayPath(messages: readonly Message[]): string | undefined {
  const hay = messages.map((message) => extractText(message, '\n')).join('\n');
  const playable = /playable_path=([^\s]+)/i.exec(hay);
  if (playable?.[1] !== undefined) return playable[1];
  const local = /https?:\/\/localhost(?::\d+)?[^\s)"']*/i.exec(hay);
  if (local?.[0] !== undefined) return local[0];
  const desktop = /[A-Za-z]:[\\/][^\s]*Desktop[^\s]*index\.html/i.exec(hay);
  return desktop?.[0];
}

function extractLastGreenTests(messages: readonly Message[]): string | undefined {
  const hay = messages.map((message) => extractText(message, '\n')).join('\n');
  const match = /(\d+)\s*\/\s*(\d+)\s*(?:pass|passed|ok)/i.exec(hay);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return `${match[1]}/${match[2]}`;
  }
  return undefined;
}

function doNotRetryLines(messages: readonly Message[]): string[] {
  const hay = messages.map((message) => extractText(message, ' ')).join('\n');
  const lines: string[] = [];
  if (/\bEINVAL\b/i.test(hay) || /host_browser=einval/i.test(hay)) {
    lines.push('- BrowserStatus / VerifySurface (host_browser=einval)');
  }
  if (lines.length === 0) return ['- (none captured)'];
  return lines;
}

function collectAssistantDecisions(messages: readonly Message[]): string[] {
  const decisions: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length < 24) continue;
    if (!/\b(?:decided|chosen|using|will use|approach|plan is|strategy)\b/i.test(text)) continue;
    decisions.push(truncateChars(text, EMERGENCY_MESSAGE_SNIPPET_CHARS));
  }
  return uniqueList(decisions).slice(0, 6);
}

function collectFilePaths(messages: readonly Message[]): string[] {
  const paths = new Set<string>();
  const pattern =
    /`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|ya?ml|toml|html|css|scss|sql))`|([A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|ya?ml|toml|html|css|scss|sql))/gi;
  for (const message of messages) {
    const text = extractText(message, '\n');
    for (const match of text.matchAll(pattern)) {
      const path = (match[1] ?? match[2] ?? '').trim();
      if (path.length > 0) paths.add(path);
    }
  }
  return [...paths].slice(0, 20);
}

function collectFailureLines(messages: readonly Message[]): string[] {
  const failures: string[] = [];
  for (const message of messages) {
    const text = extractText(message, '\n');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length < 8) continue;
      if (!/\b(?:error|failed|failure|exception|timeout|cannot|can't)\b/i.test(trimmed)) continue;
      failures.push(truncateChars(trimmed, EMERGENCY_MESSAGE_SNIPPET_CHARS));
    }
  }
  return uniqueList(failures).slice(0, 8);
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function collectEvidenceLines(messages: readonly Message[]): string[] {
  const sourceText = messages.map((message) => extractText(message, ' ')).join('\n');
  const ids = extractEvidenceIdsFromText(sourceText);
  if (ids.length === 0) return [];
  return [
    'evidence_ids:',
    `- ${ids.join(',')}`,
    ...ids
      .filter((id) => /^[a-f0-9]+$/i.test(id) && id.length >= 8)
      .map((id) => `- [liora-archived id=${id}]`),
  ];
}

function uniqueList(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
