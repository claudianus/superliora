/**
 * OpenAI Codex (ChatGPT subscription) extras — web search and image
 * generation through the ChatGPT Codex backend Responses API.
 *
 * Codex CLI exposes web search as the server-side `web_search` tool and
 * image generation via the `image_generation` tool; both run on the same
 * OAuth bearer the session already uses for chat, so subscribers get these
 * extras with zero extra keys.
 */

import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';
import { rateLimitError, RESEARCH_SEARCH_USER_AGENT } from './research-search-adapters';

export interface CodexTokenProvider {
  getAccessToken(options?: { readonly force?: boolean }): Promise<string>;
}

export const CODEX_DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const CODEX_DEFAULT_EXTRAS_MODEL = 'gpt-5.1-codex';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_SNIPPET_CHARS = 600;

export interface CodexExtrasOptions {
  readonly tokenProvider: CodexTokenProvider;
  /** Defaults to the ChatGPT Codex backend. */
  readonly baseUrl?: string;
  /** Model used for extras calls (web search / image generation). */
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface CodexRequestInput {
  readonly prompt: string;
  readonly tools: readonly Record<string, unknown>[];
}

export class CodexWebSearchProvider implements WebSearchProvider {
  constructor(private readonly options: CodexExtrasOptions) {}

  async search(query: string, options?: { limit?: number }): Promise<WebSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 10));
    const response = await callCodexResponses(this.options, {
      prompt: `Search the web and answer with sources: ${trimmed}`,
      tools: [{ type: 'web_search' }],
    });
    return extractSearchResults(response).slice(0, limit);
  }
}

export interface CodexGeneratedImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly model: string;
}

export async function generateCodexImage(
  options: CodexExtrasOptions,
  input: { readonly prompt: string; readonly size?: string },
): Promise<CodexGeneratedImage> {
  const size = normalizeImageSize(input.size);
  const response = await callCodexResponses(options, {
    prompt: input.prompt,
    tools: [{ type: 'image_generation', ...(size !== undefined ? { size } : {}) }],
  });
  const b64 = extractImageGenerationResult(response);
  if (b64 === undefined) {
    throw new Error('Codex image generation returned no image payload.');
  }
  return {
    bytes: Buffer.from(b64, 'base64'),
    mimeType: 'image/png',
    model: options.model ?? CODEX_DEFAULT_EXTRAS_MODEL,
  };
}

// ── Responses API call (streaming, ChatGPT Codex backend) ─────────────

async function callCodexResponses(
  options: CodexExtrasOptions,
  input: CodexRequestInput,
): Promise<Record<string, unknown>> {
  const base = (options.baseUrl ?? CODEX_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const token = await options.tokenProvider.getAccessToken();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${base}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'OpenAI-Beta': 'responses=experimental',
        originator: 'liora-cli',
        'User-Agent': RESEARCH_SEARCH_USER_AGENT,
        ...accountIdHeaders(token),
      },
      body: JSON.stringify({
        model: options.model ?? CODEX_DEFAULT_EXTRAS_MODEL,
        store: false,
        stream: true,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: input.prompt }],
          },
        ],
        tools: input.tools,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 429) throw rateLimitError('codex', response.status);
      throw new Error(
        `Codex extras request failed (HTTP ${String(response.status)}): ${body.slice(0, 300)}`,
      );
    }
    return readCompletedResponse(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collect the SSE stream and return the `response.completed` payload. Handles
 * both `event:`-named frames and bare `data:` frames whose payload carries
 * the `type` discriminator.
 */
function readCompletedResponse(text: string): Record<string, unknown> {
  let currentEvent = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload.length === 0 || payload === '[DONE]') continue;
    let parsed: { type?: string; response?: Record<string, unknown> } | undefined;
    try {
      parsed = JSON.parse(payload) as typeof parsed;
    } catch {
      continue;
    }
    const eventType = currentEvent !== '' ? currentEvent : parsed?.type;
    if (eventType === 'response.completed' || eventType === 'response.incomplete') {
      if (parsed?.response !== undefined) return parsed.response;
      continue;
    }
    if (eventType === 'response.failed' || eventType === 'error') {
      throw new Error(`Codex extras request failed: ${payload.slice(0, 300)}`);
    }
  }
  throw new Error('Codex extras stream ended without response.completed.');
}

/** The ChatGPT backend wants the account id when using ChatGPT OAuth. */
function accountIdHeaders(accessToken: string): Record<string, string> {
  const accountId = extractChatgptAccountId(accessToken);
  return accountId === undefined ? {} : { 'chatgpt-account-id': accountId };
}

function extractChatgptAccountId(accessToken: string): string | undefined {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    const authClaims = payload['https://api.openai.com/auth'];
    if (typeof authClaims === 'object' && authClaims !== null) {
      const id = (authClaims as Record<string, unknown>)['chatgpt_account_id'];
      if (typeof id === 'string' && id.length > 0) return id;
    }
    const flat = payload['chatgpt_account_id'];
    return typeof flat === 'string' && flat.length > 0 ? flat : undefined;
  } catch {
    return undefined;
  }
}

// ── Response parsing ──────────────────────────────────────────────────

interface ResponsesOutputItem {
  readonly type?: string;
  readonly content?: readonly ResponsesContentPart[];
  readonly result?: unknown;
}

interface ResponsesContentPart {
  readonly type?: string;
  readonly text?: string;
  readonly annotations?: readonly ResponsesAnnotation[];
}

interface ResponsesAnnotation {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
  readonly start_index?: number;
  readonly end_index?: number;
}

function outputItems(response: Record<string, unknown>): readonly ResponsesOutputItem[] {
  const output = response['output'];
  return Array.isArray(output) ? (output as ResponsesOutputItem[]) : [];
}

function extractSearchResults(response: Record<string, unknown>): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of outputItems(response)) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') continue;
        const url = annotation.url.trim();
        if (url.length === 0 || seen.has(url)) continue;
        seen.add(url);
        results.push({
          title:
            typeof annotation.title === 'string' && annotation.title.trim().length > 0
              ? annotation.title.trim()
              : safeHostname(url),
          url,
          snippet: citationSnippet(part.text, annotation),
        });
      }
    }
  }
  return results;
}

function citationSnippet(text: string, annotation: ResponsesAnnotation): string {
  if (
    typeof annotation.start_index === 'number' &&
    typeof annotation.end_index === 'number' &&
    annotation.end_index > annotation.start_index
  ) {
    const around = text.slice(
      Math.max(0, annotation.start_index - 120),
      Math.min(text.length, annotation.end_index + 120),
    );
    return truncate(around.trim(), MAX_SNIPPET_CHARS);
  }
  return truncate(text.trim(), MAX_SNIPPET_CHARS);
}

function extractImageGenerationResult(response: Record<string, unknown>): string | undefined {
  for (const item of outputItems(response)) {
    if (item.type === 'image_generation_call' && typeof item.result === 'string') {
      return item.result.length > 0 ? item.result : undefined;
    }
  }
  return undefined;
}

function normalizeImageSize(size: string | undefined): string | undefined {
  switch (size) {
    case '1024x1024':
    case '1536x1024':
    case '1024x1536':
      return size;
    case '1792x1024':
      return '1536x1024';
    case '1024x1792':
      return '1024x1536';
    default:
      return undefined;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}
