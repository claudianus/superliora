/**
 * opencode wire registry — smart per-model protocol resolution.
 *
 * Go/Zen share base `https://opencode.ai/zen/{go/}v1` but expose 3 wires:
 *   openai            → POST /v1/chat/completions  (most models)
 *   openai_responses  → POST /v1/responses         (grok-4.6, gpt-5.6-luna, muse-spark-*)
 *   anthropic         → POST /v1/messages          (minimax-*, qwen3.8-*, qwen3.7-*)
 *
 * No hard-coded if/else per model id in call sites. Resolution order:
 *  1. explicit ModelAlias.protocol (user override)
 *  2. live /models set fetched from the gateway (5-min TTL, best-effort)
 *  3. static pattern fallback derived from docs (regex, not per-id list)
 *  4. provider default (openai)
 */

import type { ProviderType } from '../config/schema';

// Stable docs-derived patterns (not per-id hardcode).
const RESPONSES_PATTERNS: readonly RegExp[] = [
  /^grok-4\.[56](?:[-_.]|$)/i,
  /^gpt-5\.6-luna(?:[-_.]|$)/i,
  /^muse-spark/i,
  // future responses-family ids tend to contain these tokens
  /-spark(?:[-_.]|$)/i,
];

const ANTHROPIC_PATTERNS: readonly RegExp[] = [
  /^minimax-m/i,
  /^qwen3\.[78]/i,
  /^qwen3\.7/i,
];

export type OpencodeWire = Extract<ProviderType, 'anthropic' | 'openai' | 'openai_responses'>;

export const OPENCODE_PROVIDER_IDS = new Set(['opencode', 'opencode-go']);

export function isOpencodeProviderId(id: string): boolean {
  return OPENCODE_PROVIDER_IDS.has(id);
}

/** Pure pattern fallback — never hits network. */
export function opencodeWireFallback(modelId: string): OpencodeWire {
  const id = modelId.trim();
  if (RESPONSES_PATTERNS.some((re) => re.test(id))) return 'openai_responses';
  if (ANTHROPIC_PATTERNS.some((re) => re.test(id))) return 'anthropic';
  return 'openai';
}

/**
 * Resolve wire for an opencode model. `liveWires` is an optional map from
 * lower-cased model id → wire built from a live /models probe.
 */
export function opencodeWireForModel(
  providerId: string,
  modelId: string,
  liveWires?: ReadonlyMap<string, OpencodeWire> | undefined,
): OpencodeWire {
  if (!isOpencodeProviderId(providerId)) return 'openai';
  const live = liveWires?.get(modelId.toLowerCase());
  if (live !== undefined) return live;
  return opencodeWireFallback(modelId);
}

/** Extract live wire map from a provider baseUrl (zen/go) — best-effort. */
export async function fetchOpencodeLiveWireMap(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, OpencodeWire> | undefined> {
  const base = baseUrl.replace(/\/+$/, '');
  // Try canonical /models under the base; Zen exposes it at /v1/models.
  const candidates = [`${base}/models`, `${base}/v1/models`];
  for (const url of candidates) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey !== undefined && apiKey.length > 0) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetchImpl(url, { headers, signal });
      if (!res.ok) continue;
      const payload: unknown = await res.json();
      const map = parseOpencodeModelsPayload(payload);
      if (map !== undefined && map.size > 0) return map;
    } catch {
      // best-effort
    }
  }
  return undefined;
}

function parseOpencodeModelsPayload(payload: unknown): Map<string, OpencodeWire> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const rec = payload as Record<string, unknown>;
  // OpenAI-compatible list: { data: [{id,...}] } or { object:'list', data: [...] }
  const data = Array.isArray(rec['data']) ? (rec['data'] as unknown[]) : Array.isArray(payload) ? (payload as unknown[]) : undefined;
  if (data === undefined || data.length === 0) return undefined;
  const out = new Map<string, OpencodeWire>();
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const id = (item as Record<string, unknown>)['id'];
    if (typeof id !== 'string' || id.length === 0) continue;
    // opencode payload does not explicitly state wire; infer via patterns.
    out.set(id.toLowerCase(), opencodeWireFallback(id));
  }
  return out;
}

/** Whether a ModelAlias protocol value is an opencode wire override. */
export function isOpencodeWireProtocol(v: string | undefined): v is OpencodeWire {
  return v === 'anthropic' || v === 'openai' || v === 'openai_responses';
}

/** Normalize a raw model id string for registry lookup. */
export function normalizeOpencodeModelId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Provider-name check for the Go gateway specifically (used for /models URL).
 */
export function opencodeModelsUrlForBase(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}
