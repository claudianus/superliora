import {
  isKimiError,
  utf8Prefix,
  Utf8PrefixBuffer,
  type LioraErrorPayload,
} from '@superliora/sdk';

import {
  STREAMING_ARGS_FIELD_RE,
  STREAMING_ARGS_PREVIEW_MAX_BYTES,
} from '#/tui/constant/streaming';

/**
 * Use a retained buffer for each live stream: the legacy string-only form cannot
 * retain a pending surrogate or a frozen prefix with unused byte capacity.
 */
export function appendStreamingArgsPreview(
  current: string | undefined,
  next: string | null | undefined,
  buffer?: Utf8PrefixBuffer,
): string {
  if (buffer !== undefined) return buffer.append(next ?? '');
  const prefix = new Utf8PrefixBuffer(STREAMING_ARGS_PREVIEW_MAX_BYTES);
  prefix.append(current ?? '');
  return prefix.append(next ?? '');
}

const JSON_SIMPLE_ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/** Decode only complete escapes; raw stream state remains untouched for the next delta. */
export function decodePartialJsonString(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[++i];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = text.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      // JSON \u escapes encode UTF-16 code units; preserve pairs until the prefix validates them.
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      i += 4;
    } else {
      out += JSON_SIMPLE_ESCAPES[next] ?? next;
    }
  }
  return utf8Prefix(out, STREAMING_ARGS_PREVIEW_MAX_BYTES);
}

/**
 * Last parse per streaming argument buffer.
 *
 * Streaming tool arguments are append-only, and the TUI re-parses the whole
 * accumulated buffer on every flush (up to 60/s) while a call streams. The
 * buffer can reach the 64 KiB preview cap, so each flush re-ran `JSON.parse`
 * plus a full `matchAll` scan over the entire prefix. A size-bounded cache
 * keyed on the buffer text short-circuits repeated parses of an unchanged
 * prefix; the bounded size keeps it from retaining dead 64 KiB buffers.
 */
const STREAMING_ARGS_CACHE_MAX_ENTRIES = 8;
/**
 * Keyed by the raw text: the parse is a pure function of it, so a hit skips
 * the UTF-8 prefix scan. Raw text longer than the byte cap (UTF-16 units never
 * exceed UTF-8 bytes) is truncated anyway and keys the separate prefix cache,
 * which keeps every retained key within the cap (in UTF-16 units).
 */
const streamingArgsCache = new Map<string, Record<string, unknown>>();
const streamingArgsPrefixCache = new Map<string, Record<string, unknown>>();

export function parseStreamingArgs(argumentsText: string): Record<string, unknown> {
  const oversized = argumentsText.length > STREAMING_ARGS_PREVIEW_MAX_BYTES;
  // Callers get their own record: a mutated result must not poison the
  // shared entry other consumers (and later flushes) read back.
  const rawHit = oversized ? undefined : streamingArgsCache.get(argumentsText);
  if (rawHit !== undefined) return { ...rawHit };
  const previewText = utf8Prefix(argumentsText, STREAMING_ARGS_PREVIEW_MAX_BYTES);
  const cache = oversized ? streamingArgsPrefixCache : streamingArgsCache;
  const cacheKey = oversized ? previewText : argumentsText;
  const cached = oversized ? cache.get(cacheKey) : undefined;
  if (cached !== undefined) return { ...cached };
  const parsed = parseStreamingArgsUncached(previewText, previewText === argumentsText);
  if (cache.size >= STREAMING_ARGS_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done !== true) cache.delete(oldest.value);
  }
  cache.set(cacheKey, parsed);
  return { ...parsed };
}

function parseStreamingArgsUncached(previewText: string, complete: boolean): Record<string, unknown> {
  if (previewText.trim().length === 0) return {};
  if (complete && previewText.trimEnd().endsWith('}')) {
    try {
      const parsed = JSON.parse(previewText) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to partial scan
    }
  }
  const result: Record<string, unknown> = {};
  for (const match of previewText.matchAll(STREAMING_ARGS_FIELD_RE)) {
    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) continue;
    if (!(key in result)) {
      result[key] = decodePartialJsonString(rawValue);
    }
  }
  return result;
}

export function argsRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

export function serializeToolResultOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  return JSON.stringify(output, null, 2);
}

export function formatErrorMessage(error: unknown): string {
  if (isKimiError(error)) {
    return formatErrorPayload({
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatErrorPayload(
  error: Pick<LioraErrorPayload, 'code' | 'message' | 'details'>,
): string {
  const filteredMessage = formatProviderFilteredMessage(error.details);
  if (filteredMessage !== undefined) return `[${error.code}] ${filteredMessage}`;
  return `[${error.code}] ${error.message}`;
}

function formatProviderFilteredMessage(
  details: Record<string, unknown> | undefined,
): string | undefined {
  const finishReason = stringDetail(details, 'finishReason');
  const rawFinishReason = stringDetail(details, 'rawFinishReason');
  if (finishReason !== 'filtered' && rawFinishReason !== 'content_filter') return undefined;

  const normalizedFinishReason = finishReason ?? 'filtered';
  const raw = rawFinishReason === undefined ? '' : `, rawFinishReason=${rawFinishReason}`;
  return `Provider filtered the response before visible output (finishReason=${normalizedFinishReason}${raw}).`;
}

function stringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = details?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
