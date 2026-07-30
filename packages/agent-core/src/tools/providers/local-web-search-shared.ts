import { parseHTML as rawParseHTML } from 'linkedom';

import type { WebSearchResult } from '../builtin/web/web-search';

export interface DomElementLike {
  textContent: string | null;
  parentNode?: DomElementLike | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomElementLike | null;
  querySelectorAll(selector: string): DomElementLike[];
}

interface DomParseResult {
  document: DomElementLike;
}

export class SearchResponseTooLargeError extends Error {
  override readonly name = 'SearchResponseTooLargeError';
}

export const parseHTML = rawParseHTML as unknown as (html: string) => DomParseResult;

export const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/html/';
export const DDG_LITE_SEARCH_URL = 'https://lite.duckduckgo.com/lite/';
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface LocalSearchAdapter {
  readonly id: string;
  search(query: string, limit: number): Promise<readonly WebSearchResult[]>;
}

export function buildResult(input: {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly date?: string;
  readonly content?: string;
}): WebSearchResult {
  const result: WebSearchResult = {
    title: normalizeText(input.title),
    url: input.url,
    snippet: normalizeText(input.snippet),
  };
  const date = normalizeText(input.date ?? '');
  if (date.length > 0) result.date = date;
  const content = input.content?.trim();
  if (content !== undefined && content.length > 0) result.content = content;
  return result;
}

export function hasUsableUrl(result: WebSearchResult): boolean {
  try {
    const parsed = new URL(result.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function prefixedSnippet(source: string, snippet: string): string {
  const normalized = normalizeText(snippet);
  return normalized.length === 0 ? `[${source}]` : `[${source}] ${normalized}`;
}

export function textOf(element: DomElementLike | null | undefined): string {
  return normalizeText(element?.textContent ?? '');
}

export function normalizeText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

export function normalizeResultUrl(rawUrl: string): string | undefined {
  return normalizeUrl(rawUrl, DEFAULT_SEARCH_URL);
}

export function normalizeUrl(rawUrl: string, baseUrl: string): string | undefined {
  if (rawUrl.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return undefined;
  }
  const unwrapped = parsed.searchParams.get('uddg');
  if (unwrapped !== null && unwrapped.length > 0) {
    try {
      parsed = new URL(unwrapped);
    } catch {
      return undefined;
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return parsed.toString();
}

export function canonicalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    for (const key of parsed.searchParams.keys()) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : [];
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLengthRaw = response.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new SearchResponseTooLargeError(
        `Search response too large: ${String(contentLength)} bytes exceeds maxBytes (${String(maxBytes)}).`,
      );
    }
  }

  const html = await response.text();
  const actualBytes = Buffer.byteLength(html, 'utf8');
  if (actualBytes > maxBytes) {
    throw new SearchResponseTooLargeError(
      `Search response too large: ${String(actualBytes)} bytes exceeds maxBytes (${String(maxBytes)}).`,
    );
  }
  return html;
}

export function isFatalSearchError(error: unknown): boolean {
  return error instanceof SearchResponseTooLargeError;
}

export async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const job = jobs[index];
      if (job === undefined) return;
      results[index] = await job();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
