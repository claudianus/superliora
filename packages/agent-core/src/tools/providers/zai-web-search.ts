/**
 * Z.AI (GLM Coding Plan) web search via the remote MCP endpoint.
 *
 * The Coding Plan bundles `web_search_prime` as a streamable-HTTP MCP server
 * gated on the plan API key. This provider speaks just enough MCP
 * (initialize → tools/call) to use it as a first-class WebSearchProvider
 * slot in the research engine, so subscription quota feeds the built-in
 * WebSearch/DeepResearch tools even when the MCP auto-injection path is
 * disabled or fails to start.
 */

import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';
import { rateLimitError, RESEARCH_SEARCH_USER_AGENT } from './research-search-adapters';

export const ZAI_SEARCH_MCP_URL = 'https://api.z.ai/api/mcp/web_search_prime/mcp';
export const ZAI_MCP_PROTOCOL_VERSION = '2025-03-26';

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_SNIPPET_CHARS = 600;

export interface ZaiWebSearchProviderOptions {
  readonly apiKey: string;
  /** Override the MCP endpoint (e.g. regional/self-hosted gateway). */
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly id?: number | string;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

export class ZaiWebSearchProvider implements WebSearchProvider {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private sessionId: string | undefined;
  private rpcId = 0;

  constructor(options: ZaiWebSearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = trimUrl(options.baseUrl ?? ZAI_SEARCH_MCP_URL);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(query: string, options?: { limit?: number }): Promise<WebSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 10));

    const result = await this.callWithSessionRetry(trimmed, limit);
    return parseZaiSearchResult(result).slice(0, limit);
  }

  /** tools/call, re-initializing the MCP session once when it expired. */
  private async callWithSessionRetry(query: string, limit: number): Promise<unknown> {
    await this.ensureSession();
    try {
      return await this.callTool(query, limit);
    } catch (error) {
      if (error instanceof ZaiSessionError) {
        this.sessionId = undefined;
        await this.ensureSession();
        return this.callTool(query, limit);
      }
      throw error;
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId !== undefined) return;
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: ZAI_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'superliora', version: '0.0.0' },
      },
    });
    const parsed = await readJsonRpcMessage(response);
    if (parsed.error !== undefined) {
      throw new Error(`Z.AI MCP initialize failed: ${parsed.error.message ?? 'unknown error'}`);
    }
    // No session id from the server → stay undefined so the next call
    // re-initializes instead of sending an empty mcp-session-id header.
    this.sessionId = response.headers.get('mcp-session-id') ?? undefined;

    // Required by the streamable-HTTP transport before further calls.
    const notify = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // 202/200 expected; a hard failure here means the session is unusable.
    if (!notify.ok) {
      this.sessionId = undefined;
      throw this.statusError('Z.AI MCP initialized notification', notify.status);
    }
  }

  private async callTool(query: string, limit: number): Promise<unknown> {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: {
        name: 'web_search_prime',
        arguments: {
          search_query: query,
          count: limit,
          content_size: 'medium',
        },
      },
    });
    if (response.status === 404 || response.status === 410) {
      // Session expired server-side — caller retries with a fresh session.
      throw new ZaiSessionError(`Z.AI MCP session expired (HTTP ${String(response.status)})`);
    }
    if (!response.ok) {
      throw this.statusError('Z.AI web search', response.status);
    }
    const parsed = await readJsonRpcMessage(response);
    if (parsed.error !== undefined) {
      const message = parsed.error.message ?? 'unknown MCP error';
      if (parsed.error.code === 429 || message.toLowerCase().includes('rate limit')) {
        throw rateLimitError('zai', 429);
      }
      throw new Error(`Z.AI web search failed: ${message}`);
    }
    return parsed.result;
  }

  private statusError(context: string, status: number): Error {
    if (status === 429) return rateLimitError('zai', status);
    return new Error(`${context} failed (HTTP ${String(status)})`);
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'User-Agent': RESEARCH_SEARCH_USER_AGENT,
          ...(this.sessionId !== undefined ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  private nextId(): number {
    this.rpcId += 1;
    return this.rpcId;
  }
}

class ZaiSessionError extends Error {
  override readonly name = 'ZaiSessionError';
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Read one JSON-RPC message from a streamable-HTTP response. The server may
 * answer with plain JSON or an SSE stream of `data: {...}` events — take the
 * last message carrying a result/error.
 */
async function readJsonRpcMessage(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!contentType.includes('text/event-stream')) {
    return JSON.parse(text) as JsonRpcResponse;
  }
  let last: JsonRpcResponse | undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload.length === 0) continue;
    try {
      const message = JSON.parse(payload) as JsonRpcResponse;
      if (message.result !== undefined || message.error !== undefined) {
        last = message;
      }
    } catch {
      // Ignore keep-alive / non-JSON data lines.
    }
  }
  if (last === undefined) {
    throw new Error('Z.AI MCP stream ended without a JSON-RPC result.');
  }
  return last;
}

interface ZaiSearchHit {
  readonly title?: unknown;
  readonly link?: unknown;
  readonly url?: unknown;
  readonly content?: unknown;
  readonly snippet?: unknown;
  readonly publish_date?: unknown;
  readonly date?: unknown;
}

/** Parse the tools/call result payload into generic search results. */
export function parseZaiSearchResult(result: unknown): WebSearchResult[] {
  if (typeof result !== 'object' || result === null) return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];

  const hits: WebSearchResult[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const typed = part as { type?: unknown; text?: unknown };
    if (typed.type !== 'text' || typeof typed.text !== 'string') continue;
    hits.push(...parseZaiSearchText(typed.text));
  }
  return hits;
}

function parseZaiSearchText(text: string): WebSearchResult[] {
  const parsed = tryParseJson(text);
  if (parsed !== undefined) {
    const array = findHitArray(parsed);
    if (array !== undefined) {
      return array.flatMap((raw) => {
        const hit = normalizeHit(raw as ZaiSearchHit);
        return hit === undefined ? [] : [hit];
      });
    }
  }
  return [];
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Depth-limited scan for the first array of hit-shaped objects. */
function findHitArray(value: unknown, depth = 0): unknown[] | undefined {
  if (depth > 3) return undefined;
  if (Array.isArray(value)) {
    return value.length > 0 && isHitShaped(value[0]) ? value : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of ['results', 'data', 'items', 'list', 'webPages']) {
      const nested = (value as Record<string, unknown>)[key];
      const found = findHitArray(nested, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function isHitShaped(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const hit = value as ZaiSearchHit;
  return typeof hit.title === 'string' && (typeof hit.link === 'string' || typeof hit.url === 'string');
}

function normalizeHit(hit: ZaiSearchHit): WebSearchResult | undefined {
  const title = typeof hit.title === 'string' ? hit.title.trim() : '';
  const url =
    (typeof hit.link === 'string' ? hit.link.trim() : '') ||
    (typeof hit.url === 'string' ? hit.url.trim() : '');
  if (title.length === 0 || url.length === 0) return undefined;
  const body =
    (typeof hit.content === 'string' ? hit.content : undefined) ??
    (typeof hit.snippet === 'string' ? hit.snippet : undefined) ??
    '';
  const date =
    (typeof hit.publish_date === 'string' ? hit.publish_date : undefined) ??
    (typeof hit.date === 'string' ? hit.date : undefined);
  return {
    title,
    url,
    snippet: body.length > MAX_SNIPPET_CHARS ? `${body.slice(0, MAX_SNIPPET_CHARS)}…` : body,
    ...(date !== undefined ? { date } : {}),
  };
}
