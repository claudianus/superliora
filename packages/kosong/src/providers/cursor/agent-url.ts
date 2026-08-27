/**
 * Resolve the Cursor AgentService/Run origin via GetServerConfig.
 *
 * Region-routed accounts are rejected (often HTTP 200 + immediate close) by
 * the wrong `agentn.*` host. Memoize in-process only — never persist, never
 * silently pin `api2.cursor.sh`.
 */

import { createHash } from 'node:crypto';

import { CURSOR_SERVER_CONFIG_PATH } from './constants';
import { buildCursorIdentityHeaders } from './headers';
import {
  defaultCursorAgentFallbackOrigin,
  defaultCursorApiOrigin,
  explicitCursorAgentOrigin,
  normalizeCursorAgentOrigin,
} from './hosts';
import { cursorHttp2Unary, decodeCursorJsonBody } from './unary';

export interface ResolveCursorAgentOriginOptions {
  readonly token: string;
  /** Provider `baseUrl` — used only when it is already an agent host. */
  readonly configuredBaseUrl?: string;
  /** Auth/catalog host for GetServerConfig (default api2). */
  readonly apiBaseUrl?: string;
  readonly clientVersion: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** When true, skip GetServerConfig and use the global fallback. Tests. */
  readonly skipServerConfig?: boolean;
}

const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function cacheKey(token: string, apiOrigin: string): string {
  return `${tokenKey(token)}|${apiOrigin}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringish(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function recordProp(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const inner = value[key];
    if (isRecord(inner)) return inner;
  }
  return undefined;
}

/** Pull `agentUrlConfig.agentnUrl` (camel or snake) out of GetServerConfig JSON. */
export function parseGetServerConfigAgentUrl(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const cfg =
    recordProp(body, 'agentUrlConfig', 'agent_url_config') ??
    recordProp(recordProp(body, 'serverConfig', 'server_config') ?? {}, 'agentUrlConfig', 'agent_url_config');
  if (cfg === undefined) return undefined;
  return (
    stringish(cfg['agentnUrl']) ??
    stringish(cfg['agentn_url']) ??
    stringish(cfg['agentUrl']) ??
    stringish(cfg['agent_url'])
  );
}

export function invalidateCursorAgentOriginCache(): void {
  resolved.clear();
  inflight.clear();
}

async function fetchGetServerConfigOrigin(
  token: string,
  apiOrigin: string,
  clientVersion: string,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
): Promise<string | undefined> {
  const headers = buildCursorIdentityHeaders(clientVersion);
  const payload = Buffer.from(JSON.stringify({ telem_enabled: false }), 'utf8');
  const result = await cursorHttp2Unary({
    baseUrl: apiOrigin,
    path: CURSOR_SERVER_CONFIG_PATH,
    token,
    headers,
    body: new Uint8Array(payload),
    contentType: 'application/json',
    timeoutMs: options.timeoutMs ?? 8_000,
    signal: options.signal,
  });
  if (result.status !== undefined && result.status >= 400) {
    throw new Error(`Cursor GetServerConfig failed (HTTP ${result.status})`);
  }
  const json = decodeCursorJsonBody(result.body);
  const raw = parseGetServerConfigAgentUrl(json);
  return normalizeCursorAgentOrigin(raw);
}

/**
 * Resolve the Run stream origin for this account.
 *
 * 1. Explicit region agent override (not api2, not the global fallback)
 * 2. In-process memo of GetServerConfig
 * 3. Live GetServerConfig
 *
 * GetServerConfig failure is thrown — a silent global-host fallback is how
 * region-routed accounts get "This region is not available". Tests may pass
 * `skipServerConfig` to use the global fallback without a network call.
 */
export async function resolveCursorAgentOrigin(
  options: ResolveCursorAgentOriginOptions,
): Promise<string> {
  const override = explicitCursorAgentOrigin(options.configuredBaseUrl);
  if (override !== undefined) return override;

  if (options.skipServerConfig === true) {
    return defaultCursorAgentFallbackOrigin();
  }

  const apiOrigin = normalizeCursorApiOrigin(options.apiBaseUrl) ?? defaultCursorApiOrigin();
  const key = cacheKey(options.token, apiOrigin);
  const memo = resolved.get(key);
  if (memo !== undefined) return memo;
  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    const fromConfig = await fetchGetServerConfigOrigin(
      options.token,
      apiOrigin,
      options.clientVersion,
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );
    if (fromConfig === undefined) {
      throw new Error(
        'Cursor GetServerConfig returned no region agent host for this account.',
      );
    }
    resolved.set(key, fromConfig);
    return fromConfig;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

function normalizeCursorApiOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
