import { extractText, type Message } from '@superliora/kosong';

import { estimateTokens } from '../../utils/tokens';
import type { CompactionPlan } from './planner';
import { renderMessagesToText } from './render-messages';

const EMERGENCY_NARRATIVE_MAX_TOKENS = 8_000;
const EMERGENCY_MESSAGE_SNIPPET_CHARS = 600;
const EMERGENCY_TOOL_SNIPPET_CHARS = 400;

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
  const toolHighlights = collectToolHighlights(messages);
  const filePaths = collectFilePaths(messages);
  const failureLines = collectFailureLines(messages);
  const narrative = truncateToTokenBudget(
    renderMessagesToText(messages),
    EMERGENCY_NARRATIVE_MAX_TOKENS,
  );

  const lines = [
    'current_goal:',
    `- ${latestUser ?? 'Continue the active task from the compacted conversation state.'}`,
    'last_known_state:',
    `- Emergency extractive backstop: ${String(messages.length)} messages (${String(plan.compactedTokens)} estimated tokens) were compacted because the LLM summarizer failed.`,
    instruction !== undefined && instruction.trim().length > 0
      ? `- User compaction instruction: ${instruction.trim()}`
      : undefined,
    'decisions:',
    ...collectAssistantDecisions(messages).map((item) => `- ${item}`),
    'files_touched:',
    ...(filePaths.length > 0 ? filePaths.map((file) => `- ${file}`) : ['- (not captured during compaction.)']),
    'failed_attempts:',
    ...(failureLines.length > 0 ? failureLines.map((line) => `- ${line}`) : ['- (not captured during compaction.)']),
    'open_questions:',
    '- Re-verify any step marked unverified below before relying on it.',
    'next_actions:',
    `- Resume from the retained recent messages and verify: ${latestUser ?? 'the pending user request.'}`,
    'raw_refs:',
    ...(plan.rawRefs.length > 0
      ? plan.rawRefs.map(
          (ref) =>
            `- ${ref.kind} messages[${String(ref.messageStart)}..${String(ref.messageEnd)}] (~${String(ref.tokens)} tokens)`,
        )
      : ['- (not captured during compaction.)']),
    '',
    '## Emergency extractive transcript',
    'The LLM compaction summarizer failed after retries. This deterministic snapshot preserves continuity.',
    '',
    ...(toolHighlights.length > 0
      ? ['### Tool exchange highlights', ...toolHighlights, '']
      : []),
    narrative,
  ].filter((line): line is string => line !== undefined);

  return lines.join('\n');
}

function findLatestUserText(messages: readonly Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length > 0) return truncateChars(text, EMERGENCY_MESSAGE_SNIPPET_CHARS);
  }
  return undefined;
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

function collectToolHighlights(messages: readonly Message[]): string[] {
  const highlights: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls.length > 0) {
      for (const toolCall of message.toolCalls) {
        highlights.push(
          `- called ${toolCall.name}(${truncateChars(toolCall.arguments ?? '', EMERGENCY_TOOL_SNIPPET_CHARS)})`,
        );
      }
      continue;
    }
    if (message.role !== 'tool') continue;
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length === 0) continue;
    highlights.push(`- tool result: ${truncateChars(text, EMERGENCY_TOOL_SNIPPET_CHARS)}`);
  }
  return highlights.slice(0, 12);
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

function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || text.length === 0) return '';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const truncated = text.slice(0, low);
  return truncated.length < text.length ? `${truncated}\n…[transcript truncated]` : truncated;
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
