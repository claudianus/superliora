/**
 * Cursor host classification.
 *
 * Login / catalog live on `api2.cursor.sh`. AgentService/Run lives on a
 * region-specific `agentn.*` (or `agent-*`) origin from GetServerConfig.
 * Sending Run to the auth host is a common source of Connect `internal`
 * errors and silent HTTP 200 closes.
 */

import { CURSOR_AGENT_FALLBACK_URL, CURSOR_API_BASE_URL } from './constants';

const CURSOR_SH_HOST = /^([a-z0-9-]+\.)+cursor\.sh$/i;
const AUTH_API_HOST = /^(api2|api3)(?:\.[a-z0-9-]+)*\.cursor\.sh$/i;

export function cursorOrigin(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:') return undefined;
    if (parsed.username.length > 0 || parsed.password.length > 0) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function cursorHostname(raw: string): string | undefined {
  const origin = cursorOrigin(raw);
  if (origin === undefined) return undefined;
  return new URL(origin).hostname;
}

export function isAllowedCursorShHost(hostname: string): boolean {
  return CURSOR_SH_HOST.test(hostname);
}

/** True for auth/catalog hosts that must not receive AgentService/Run. */
export function isCursorAuthApiHost(hostname: string): boolean {
  return AUTH_API_HOST.test(hostname);
}

export function isCursorAuthApiOrigin(raw: string): boolean {
  const host = cursorHostname(raw);
  return host !== undefined && isCursorAuthApiHost(host);
}

/**
 * Normalize a GetServerConfig / override agent URL to an https origin.
 * Returns undefined for missing, non-https, or non-`*.cursor.sh` hosts.
 */
export function normalizeCursorAgentOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const origin = cursorOrigin(raw);
  if (origin === undefined) return undefined;
  const host = new URL(origin).hostname;
  if (!isAllowedCursorShHost(host)) return undefined;
  if (isCursorAuthApiHost(host)) return undefined;
  return origin;
}

/** True when `raw` is the last-resort global agent host, not a region pin. */
export function isCursorDefaultFallbackOrigin(raw: string | undefined): boolean {
  return normalizeCursorAgentOrigin(raw) === CURSOR_AGENT_FALLBACK_URL;
}

/**
 * Explicit Run override from config/env. Auth-API origins and the global
 * fallback host are ignored so leftover defaults cannot skip GetServerConfig
 * (wrong region → silent HTTP 200 close / "region is not available").
 */
export function explicitCursorAgentOrigin(raw: string | undefined): string | undefined {
  const origin = normalizeCursorAgentOrigin(raw);
  if (origin === undefined || origin === CURSOR_AGENT_FALLBACK_URL) return undefined;
  return origin;
}

export function defaultCursorApiOrigin(): string {
  return CURSOR_API_BASE_URL;
}

export function defaultCursorAgentFallbackOrigin(): string {
  return CURSOR_AGENT_FALLBACK_URL;
}
