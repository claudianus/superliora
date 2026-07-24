import { createProvider, type ChatProvider, type GenerateResult, type Message } from '@superliora/kosong';

import type { GenerateOptionsWithRequestLogFields } from '../llm-request-logger';
import type { Agent } from '../index';

/**
 * Lightweight LLM intelligence behind the TUI prompt box:
 *
 * - {@link inlineComplete} predicts the next words/sentence the user is typing
 *   so the editor can render it as dimmed "ghost" text (Tab to accept).
 * - {@link suggestPrompts} proposes a handful of contextually relevant next
 *   tasks when the prompt box is empty.
 *
 * Both paths are deliberately cheap: a dedicated fast model
 * (`loopControl.completionModel`, falling back to the session model), thinking
 * turned off, and a small completion-token budget. Failures are swallowed and
 * reported as empty results so the input box is never disturbed.
 */

/** models.dev catalog URL used to resolve per-token model pricing. */
const MODELS_DEV_API_URL = 'https://models.dev/api.json';
/** Timeout for the pricing catalog fetch (ms). */
const PRICING_FETCH_TIMEOUT_MS = 5_000;

/**
 * Module-level lazy cache: model-id (lowercase) → input cost per million
 * tokens.  Fetched once from models.dev; stays `undefined` until the fetch
 * settles so callers can fall back to name heuristics immediately.
 */
let modelPricingPromise: Promise<Map<string, number>> | undefined;

function getModelPricing(): Promise<Map<string, number>> {
  modelPricingPromise ??= fetchModelPricing();
  return modelPricingPromise;
}

async function fetchModelPricing(): Promise<Map<string, number>> {
  const pricing = new Map<string, number>();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRICING_FETCH_TIMEOUT_MS);
    const res = await fetch(MODELS_DEV_API_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return pricing;
    const data = (await res.json()) as Record<
      string,
      { models?: Record<string, { id?: string; cost?: { input?: number } }> }
    >;
    for (const provider of Object.values(data)) {
      if (provider.models === undefined) continue;
      for (const model of Object.values(provider.models)) {
        if (model.id !== undefined && model.cost?.input != null) {
          pricing.set(model.id.toLowerCase(), model.cost.input);
        }
      }
    }
  } catch {
    // Network failure — callers fall back to name heuristics.
  }
  return pricing;
}

/** Max completion tokens for an inline next-words prediction. */
export const INLINE_MAX_TOKENS = 128;
/** Max completion tokens for the next-task suggestion list. */
export const SUGGEST_MAX_TOKENS = 96;
/** Upper bound on suggestions returned to the TUI. */
export const MAX_SUGGESTIONS = 5;
/** Character budget for the compacted history sent as context. */
const HISTORY_CONTEXT_CHARS = 800;
/** Per-message truncation when compacting history. */
const PER_MESSAGE_CHARS = 400;

export interface InlineCompletePayload {
  readonly text: string;
  readonly cursorLine: number;
  readonly cursorCol: number;
  readonly signal?: AbortSignal;
}

export interface InlineCompleteResult {
  readonly completion: string;
}

export interface SuggestPromptsPayload {
  readonly signal?: AbortSignal;
}

export interface SuggestPromptsResult {
  readonly suggestions: readonly string[];
}

const INLINE_SYSTEM_PROMPT = [
  'You are an inline autocomplete engine for an AI coding assistant prompt box.',
  'Given the recent conversation context and the text the user is currently typing,',
  'predict the most likely immediate continuation.',
  'Output ONLY the continuation text that comes right after what the user already typed:',
  'do not repeat the typed text, do not add quotes, explanations, or markdown fences,',
  'and do not start a new unrelated topic. Keep it short (a few words up to one sentence).',
  'If you cannot predict a useful continuation, output nothing.',
].join(' ');

const SUGGEST_SYSTEM_PROMPT = [
  'You are a next-task suggestion engine for an AI coding assistant.',
  'Given the recent conversation context, suggest up to 5 short, concrete next tasks',
  'the user is most likely to want to do next.',
  'Output each suggestion on its own line with no numbering, no bullets, and no quotes.',
  'Each suggestion must be a concise imperative prompt of at most about 12 words.',
  'If there is no sensible suggestion, output nothing.',
].join(' ');

export class PromptIntelligenceService {
  constructor(private readonly agent: Agent) {}

  async inlineComplete(payload: InlineCompletePayload): Promise<InlineCompleteResult> {
    const empty: InlineCompleteResult = { completion: '' };
    if (!this.isEnabled()) return empty;
    const draft = extractDraft(payload);
    if (draft.length === 0) return empty;

    const provider = await this.resolveProvider(INLINE_MAX_TOKENS);
    if (provider === undefined) return empty;

    const context = summarizeHistory(this.agent.context.messages, HISTORY_CONTEXT_CHARS);
    const userPrompt =
      (context.length > 0 ? `Recent conversation:\n${context}\n\n` : '') +
      `Text the user is typing:\n${draft}`;
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: userPrompt }], toolCalls: [] },
    ];

    try {
      const options: GenerateOptionsWithRequestLogFields = {
        signal: payload.signal,
        runtimeModelAlias: this.completionModelAlias(),
      };
      const response = await this.agent.generate(
        provider,
        INLINE_SYSTEM_PROMPT,
        [],
        messages,
        undefined,
        options,
      );
      const completion = cleanInlineCompletion(extractText(response), draft);
      return { completion };
    } catch (error) {
      if (!isAbortError(error)) this.agent.log.warn('inline completion failed', error);
      return empty;
    }
  }

  async suggestPrompts(payload: SuggestPromptsPayload = {}): Promise<SuggestPromptsResult> {
    const empty: SuggestPromptsResult = { suggestions: [] };
    if (!this.isEnabled()) return empty;

    const provider = await this.resolveProvider(SUGGEST_MAX_TOKENS);
    if (provider === undefined) return empty;

    const context = summarizeHistory(this.agent.context.messages, HISTORY_CONTEXT_CHARS);
    const preference = this.agent.getResponseLanguagePreference();
    const languageLine =
      preference === undefined ? '' : ` Write each suggestion in ${preference.label}.`;
    const userPrompt =
      context.length > 0
        ? `Recent conversation:\n${context}\n\nSuggest the next tasks.${languageLine}`
        : `The conversation just started. Suggest a few sensible first tasks.${languageLine}`;
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: userPrompt }], toolCalls: [] },
    ];

    try {
      const options: GenerateOptionsWithRequestLogFields = {
        signal: payload.signal,
        runtimeModelAlias: this.completionModelAlias(),
      };
      const response = await this.agent.generate(
        provider,
        SUGGEST_SYSTEM_PROMPT,
        [],
        messages,
        undefined,
        options,
      );
      const suggestions = parseSuggestionLines(extractText(response));
      return { suggestions };
    } catch (error) {
      if (!isAbortError(error)) this.agent.log.warn('prompt suggestions failed', error);
      return empty;
    }
  }

  private isEnabled(): boolean {
    return this.agent.experimentalFlags.enabled('prompt_intelligence');
  }

  private completionModelAlias(): string | undefined {
    return this.agent.kimiConfig?.loopControl?.completionModel;
  }

  /**
   * When no explicit `completionModel` is configured, pick the cheapest
   * model from the user's configured aliases.  Prefers actual per-token
   * pricing from the models.dev catalog; falls back to well-known
   * model-name patterns when pricing is unavailable.
   */
  private async inferCheapModelAlias(): Promise<string | undefined> {
    const models = this.agent.kimiConfig?.models;
    if (models === undefined) return undefined;

    // 1. Try actual pricing data from models.dev.
    const pricing = await getModelPricing();
    if (pricing.size > 0) {
      let bestAlias: string | undefined;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const [alias, config] of Object.entries(models)) {
        const cost = pricing.get(config.model.toLowerCase());
        if (cost !== undefined && cost < bestCost) {
          bestCost = cost;
          bestAlias = alias;
        }
      }
      if (bestAlias !== undefined) return bestAlias;
    }

    // 2. Fallback: name-pattern heuristic (lower score = cheaper / faster).
    const CHEAP_PATTERNS: ReadonlyArray<{ pattern: string; score: number }> = [
      { pattern: 'haiku', score: 1 },
      { pattern: 'flash', score: 2 },
      { pattern: 'nano', score: 3 },
      { pattern: 'mini', score: 4 },
      { pattern: 'lite', score: 5 },
      { pattern: 'turbo', score: 6 },
    ];

    let bestAlias: string | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const [alias, config] of Object.entries(models)) {
      const haystack = `${alias} ${config.model}`.toLowerCase();
      for (const { pattern, score } of CHEAP_PATTERNS) {
        if (haystack.includes(pattern) && score < bestScore) {
          bestScore = score;
          bestAlias = alias;
        }
      }
    }
    return bestAlias;
  }

  private async resolveProvider(maxTokens: number): Promise<ChatProvider | undefined> {
    try {
      const alias = this.completionModelAlias() ?? (await this.inferCheapModelAlias());
      const resolved = alias ? this.agent.modelProvider?.resolveProviderConfig(alias) : undefined;
      let provider = resolved ? createProvider(resolved.provider) : this.agent.config.provider;
      provider = provider.withThinking('off');
      if (typeof provider.withMaxCompletionTokens === 'function') {
        provider = provider.withMaxCompletionTokens(maxTokens);
      }
      return provider;
    } catch (error) {
      this.agent.log.warn('prompt intelligence provider resolution failed', error);
      return undefined;
    }
  }
}

/**
 * Resolve the text the user has typed up to the cursor. Only the active line
 * (and any trailing partial line) matters for a next-words prediction, so we
 * collapse to the text before the cursor on the cursor line plus following
 * lines, which is what the continuation should extend.
 */
export function extractDraft(payload: InlineCompletePayload): string {
  const lines = payload.text.split('\n');
  const cursorLine = Math.max(0, Math.min(payload.cursorLine, lines.length - 1));
  const line = lines[cursorLine] ?? '';
  const col = Math.max(0, Math.min(payload.cursorCol, line.length));
  const before = line.slice(0, col);
  const after = [line.slice(col), ...lines.slice(cursorLine + 1)].join('\n');
  // The draft is everything up to the cursor; trailing text (if any) is kept so
  // the model can bridge across it, but predictions are cleaned to stop before
  // re-emitting it.
  return (before + (after.length > 0 ? `\n${after}` : '')).trim();
}

/**
 * Compact the conversation history into a short plain-text summary bounded by
 * `maxChars`. Keeps the most recent messages, truncating each, and prefixes
 * each with its role. Tool calls/results are reduced to their textual essence.
 */
export function summarizeHistory(messages: readonly Message[], maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.role === 'system') continue;
    const text = messageText(message);
    if (text.length === 0) continue;
    const clipped = clipMiddle(text, PER_MESSAGE_CHARS);
    const line = `${message.role}: ${clipped}`;
    if (used + line.length > maxChars) {
      if (parts.length === 0) parts.push(clipMiddle(line, maxChars));
      break;
    }
    parts.push(line);
    used += line.length + 1;
  }
  return parts.reverse().join('\n');
}

/**
 * Clean a raw inline-completion response into a usable ghost suffix:
 * strips wrapping quotes/fences, cuts at the first newline (single-line ghost),
 * drops any leading repetition of the typed draft tail, and trims whitespace.
 */
export function cleanInlineCompletion(raw: string, draft: string): string {
  let text = raw.trim();
  if (text.length === 0) return '';
  // Drop markdown code fences if the model wrapped the output.
  text = text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
  // Ghost text is single-line: stop at the first newline.
  const newlineIndex = text.indexOf('\n');
  if (newlineIndex !== -1) text = text.slice(0, newlineIndex);
  text = stripWrappingQuotes(text).trim();
  text = dropDraftOverlap(text, draft);
  return text.trimEnd();
}

/** Parse a suggestion response into clean, de-duplicated single-line prompts. */
export function parseSuggestionLines(raw: string): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const rawLine of raw.split('\n')) {
    let line = rawLine.trim();
    if (line.length === 0) continue;
    // Strip leading numbering / bullets: "1.", "1)", "-", "*", "•".
    line = line.replace(/^(?:\d+[.)]|[-*•])\s+/, '');
    line = stripWrappingQuotes(line).trim();
    if (line.length === 0) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(line);
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

function messageText(message: Message): string {
  const contentText = message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim();
  if (contentText.length > 0) return contentText;
  const toolNames = message.toolCalls.map((call) => call.name).filter((name) => name.length > 0);
  if (toolNames.length > 0) return `[tool calls: ${toolNames.join(', ')}]`;
  return '';
}

function clipMiddle(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = Math.ceil(max * 0.7);
  const tail = max - head - 1;
  return `${trimmed.slice(0, head)}…${trimmed.slice(trimmed.length - tail)}`;
}

function stripWrappingQuotes(text: string): string {
  let result = text.trim();
  while (result.length >= 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
      result = result.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return result;
}

/**
 * If the model re-emitted the tail of what the user already typed, drop that
 * overlapping prefix so the ghost text only adds genuinely new characters.
 */
function dropDraftOverlap(text: string, draft: string): string {
  const draftTail = draft.trimEnd();
  if (draftTail.length === 0) return text;
  const maxOverlap = Math.min(text.length, draftTail.length, 60);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const suffix = draftTail.slice(draftTail.length - overlap);
    if (text.startsWith(suffix)) {
      return text.slice(overlap);
    }
  }
  return text;
}

function extractText(response: GenerateResult): string {
  const content = response.message.content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
