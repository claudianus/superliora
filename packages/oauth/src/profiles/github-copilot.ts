/**
 * GitHub Copilot profile — paste/env a GitHub user token, then exchange it
 * for a short-lived Copilot session token.
 *
 * **Experimental, off by default.** SuperLiora does not ship a GitHub OAuth
 * app, and must not impersonate VS Code's GitHub App client id. Login is
 * therefore paste / env (`GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_COPILOT_TOKEN`)
 * only. Enable the picker with `SUPERLIORA_EXPERIMENTAL_GITHUB_COPILOT=1`.
 *
 * Chat is OpenAI-compatible at `endpoints.api` from
 * `GET https://api.github.com/copilot_internal/v2/token`. A raw `ghu_` /
 * GitHub token is rejected until that exchange. Hosts are taken from the
 * token response (enterprise vs individual), not hardcoded.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { OAuthUnauthorizedError } from '../errors';
import { isRecord } from '../utils';
import type { TokenInfo } from '../types';
import type { ProviderModelPreset, ProviderProfile } from './provider-profile';

export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot';
export const GITHUB_COPILOT_OAUTH_HOST = 'https://api.github.com';
export const GITHUB_COPILOT_API_BASE_URL = 'https://api.githubcopilot.com';
export const GITHUB_COPILOT_TOKEN_URL = `${GITHUB_COPILOT_OAUTH_HOST}/copilot_internal/v2/token`;
export const GITHUB_COPILOT_USER_URL = `${GITHUB_COPILOT_OAUTH_HOST}/copilot_internal/user`;

/** Env names models.dev lists, plus the usual GitHub CLI aliases. */
export const GITHUB_COPILOT_TOKEN_ENVS = [
  'GITHUB_COPILOT_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
] as const;

/**
 * Copilot chat rejects requests without these identity headers. Values name
 * SuperLiora; `Copilot-Integration-Id` is the wire id the API accepts
 * (not an OAuth client id).
 */
export const GITHUB_COPILOT_EDITOR_VERSION = 'SuperLiora/1.0.0';
export const GITHUB_COPILOT_EDITOR_PLUGIN_VERSION = 'SuperLiora/1.0.0';
export const GITHUB_COPILOT_INTEGRATION_ID = 'vscode-chat';

/** Slack before `expires_at` when a cached session is treated as stale. */
const SESSION_REFRESH_SLACK_SEC = 60;
const DEFAULT_SESSION_TTL_SEC = 25 * 60;
const USER_TOKEN_TTL_SEC = 10 * 365 * 24 * 60 * 60;

export function githubCopilotRequestHeaders(): Record<string, string> {
  return {
    'Editor-Version': GITHUB_COPILOT_EDITOR_VERSION,
    'Editor-Plugin-Version': GITHUB_COPILOT_EDITOR_PLUGIN_VERSION,
    'Copilot-Integration-Id': GITHUB_COPILOT_INTEGRATION_ID,
    'User-Agent': GITHUB_COPILOT_EDITOR_VERSION,
  };
}

export function isGitHubCopilotProviderId(id: string): boolean {
  const lower = id.trim().toLowerCase();
  return lower === GITHUB_COPILOT_PROVIDER_ID || lower === 'github_copilot';
}

export function isGitHubCopilotBaseUrl(url: string | undefined): boolean {
  if (url === undefined || url.length === 0) return false;
  return /githubcopilot\.com|copilot_internal|copilot-proxy/i.test(url);
}

export function isGitHubUserToken(token: string): boolean {
  return /^(ghu_|ghp_|gho_|ghr_|github_pat_)/.test(token.trim());
}

export function isGitHubCopilotSessionToken(token: string): boolean {
  return /(?:^|[;\s])tid=/.test(token.trim());
}

export function readGitHubCopilotEnvToken(
  env: NodeJS.Dict<string> = process.env,
): string | undefined {
  for (const name of GITHUB_COPILOT_TOKEN_ENVS) {
    const value = env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

const execFileAsync = promisify(execFile);

/**
 * Best-effort `gh auth token` prefill for the paste dialog. Times out quickly
 * and returns undefined when the GitHub CLI is missing or not logged in.
 */
export async function readGitHubCopilotGhCliToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      timeout: 2000,
      windowsHide: true,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export function githubCopilotUserTokenInfo(userToken: string): TokenInfo {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: userToken,
    refreshToken: userToken,
    expiresAt: now + USER_TOKEN_TTL_SEC,
    expiresIn: USER_TOKEN_TTL_SEC,
    scope: 'github-copilot',
    tokenType: 'Bearer',
  };
}

export interface GitHubCopilotSession {
  readonly token: string;
  readonly expiresAtSec: number;
  readonly apiBaseUrl: string;
}

interface CachedCopilotSession extends GitHubCopilotSession {
  readonly userToken: string;
}

const sessionCache = new Map<string, CachedCopilotSession>();

export function resetGitHubCopilotSessionCache(): void {
  sessionCache.clear();
}

export function peekGitHubCopilotSession(userToken: string): GitHubCopilotSession | undefined {
  const cached = sessionCache.get(userToken);
  if (cached === undefined) return undefined;
  return { token: cached.token, expiresAtSec: cached.expiresAtSec, apiBaseUrl: cached.apiBaseUrl };
}

export interface EnsureGitHubCopilotSessionOptions {
  readonly force?: boolean;
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Exchange a GitHub user token for a Copilot session token. Cached until
 * shortly before `expires_at`. Pass `force` after a 401.
 */
export async function ensureGitHubCopilotSession(
  userToken: string,
  options: EnsureGitHubCopilotSessionOptions = {},
): Promise<GitHubCopilotSession> {
  const token = userToken.trim();
  if (token.length === 0) {
    throw new OAuthUnauthorizedError('GitHub Copilot token is empty.');
  }
  if (isGitHubCopilotSessionToken(token)) {
    return sessionFromAlreadyExchanged(token);
  }
  const nowSec = Math.floor((options.now ?? Date.now)() / 1000);
  const cached = sessionCache.get(token);
  if (
    options.force !== true &&
    cached !== undefined &&
    cached.expiresAtSec - SESSION_REFRESH_SLACK_SEC > nowSec
  ) {
    return cached;
  }
  const session = await exchangeGitHubCopilotSession(token, options.fetchImpl);
  sessionCache.set(token, { ...session, userToken: token });
  return session;
}

export async function exchangeGitHubCopilotSession(
  userToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubCopilotSession> {
  const res = await fetchImpl(GITHUB_COPILOT_TOKEN_URL, {
    headers: {
      Authorization: githubApiAuthorization(userToken),
      Accept: 'application/json',
      ...githubCopilotRequestHeaders(),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new OAuthUnauthorizedError(
      'GitHub Copilot session exchange was rejected. Check the token and Copilot subscription.',
    );
  }
  if (!res.ok) {
    throw new OAuthUnauthorizedError(`GitHub Copilot session exchange failed (HTTP ${String(res.status)}).`);
  }
  const parsed = parseGitHubCopilotTokenResponse(await res.json());
  if (parsed === undefined) {
    throw new OAuthUnauthorizedError('GitHub Copilot session exchange returned no token.');
  }
  return parsed;
}

export function parseGitHubCopilotTokenResponse(payload: unknown): GitHubCopilotSession | undefined {
  if (!isRecord(payload)) return undefined;
  const token = readString(payload['token']) ?? readString(payload['access_token']);
  if (token === undefined || token.length === 0) return undefined;
  const expiresAtSec = parseExpiresAtSec(payload['expires_at']) ?? parseTidExp(token);
  return {
    token,
    expiresAtSec: expiresAtSec ?? Math.floor(Date.now() / 1000) + DEFAULT_SESSION_TTL_SEC,
    apiBaseUrl: resolveCopilotApiBaseUrl(payload),
  };
}

export function parseGitHubCopilotQuotaSnapshots(payload: unknown): readonly CopilotQuotaRow[] {
  if (!isRecord(payload)) return [];
  const snapshots = payload['quota_snapshots'];
  if (!isRecord(snapshots)) return [];
  const rows: CopilotQuotaRow[] = [];
  for (const [key, value] of Object.entries(snapshots)) {
    if (!isRecord(value)) continue;
    const unlimited = value['unlimited'] === true;
    const entitlement = num(value['entitlement']);
    const remaining = num(value['remaining']);
    if (unlimited) {
      rows.push({ key, label: quotaLabel(key), used: 0, limit: 1, unlimited: true });
      continue;
    }
    if (entitlement === null || entitlement <= 0) continue;
    const used = remaining !== null ? Math.max(0, entitlement - remaining) : 0;
    rows.push({ key, label: quotaLabel(key), used, limit: entitlement, unlimited: false });
  }
  return rows;
}

export interface CopilotQuotaRow {
  readonly key: string;
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly unlimited: boolean;
}

export const GITHUB_COPILOT_PROFILE: ProviderProfile = {
  id: GITHUB_COPILOT_PROVIDER_ID,
  displayName: 'GitHub Copilot (token login)',
  description:
    'Paste a GitHub / Copilot token (experimental). SuperLiora exchanges it for a Copilot session; no third-party GitHub App.',
  authType: 'oauth',
  flow: {
    name: GITHUB_COPILOT_PROVIDER_ID,
    oauthHost: GITHUB_COPILOT_OAUTH_HOST,
    // SuperLiora has no GitHub OAuth app. This is a storage label only.
    clientId: 'superliora',
    kind: 'paste_token',
    userAgent: 'liora-cli',
  },
  wire: 'openai',
  apiBaseUrl: GITHUB_COPILOT_API_BASE_URL,
  customHeaders: githubCopilotRequestHeaders(),
  signupUrl: 'https://github.com/features/copilot',
  docUrl: 'https://docs.github.com/en/copilot',
  models: [
    {
      id: 'gpt-4.1',
      displayName: 'GPT-4.1',
      maxContextSize: 128000,
      capabilities: ['tool_use', 'image_in'],
    },
    {
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      maxContextSize: 128000,
      capabilities: ['tool_use', 'image_in'],
    },
    {
      id: 'claude-sonnet-4',
      displayName: 'Claude Sonnet 4',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
  ],
};

export async function fetchGitHubCopilotModels(
  session: GitHubCopilotSession,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly ProviderModelPreset[] | undefined> {
  const base = session.apiBaseUrl.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/json',
      ...githubCopilotRequestHeaders(),
    },
  });
  if (!res.ok) return undefined;
  return parseGitHubCopilotModelsResponse(await res.json());
}

export function parseGitHubCopilotModelsResponse(payload: unknown): readonly ProviderModelPreset[] | undefined {
  if (!isRecord(payload)) return undefined;
  const data = payload['data'];
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const models: ProviderModelPreset[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const id = readString(item['id']);
    if (id === undefined) continue;
    const capabilities = isRecord(item['capabilities']) ? item['capabilities'] : undefined;
    const type = capabilities !== undefined ? readString(capabilities['type']) : undefined;
    if (type !== undefined && type !== 'chat') continue;
    const supports = capabilities !== undefined && isRecord(capabilities['supports'])
      ? capabilities['supports']
      : undefined;
    const limits = capabilities !== undefined && isRecord(capabilities['limits'])
      ? capabilities['limits']
      : undefined;
    const maxContext =
      num(limits?.['max_prompt_tokens']) ??
      num(limits?.['max_context_window_tokens']) ??
      128000;
    const caps: string[] = ['tool_use'];
    if (supports?.['vision'] === true || supports?.['image'] === true) caps.push('image_in');
    if (supports?.['thinking'] === true || supports?.['reasoning'] === true) caps.push('thinking');
    models.push({
      id,
      displayName: readString(item['name']) ?? id,
      maxContextSize: maxContext,
      capabilities: caps,
    });
  }
  return models.length > 0 ? models : undefined;
}

function githubApiAuthorization(userToken: string): string {
  return `token ${userToken}`;
}

function sessionFromAlreadyExchanged(token: string): GitHubCopilotSession {
  return {
    token,
    expiresAtSec: parseTidExp(token) ?? Math.floor(Date.now() / 1000) + DEFAULT_SESSION_TTL_SEC,
    apiBaseUrl: GITHUB_COPILOT_API_BASE_URL,
  };
}

function resolveCopilotApiBaseUrl(payload: Record<string, unknown>): string {
  const endpoints = isRecord(payload['endpoints']) ? payload['endpoints'] : undefined;
  const raw =
    (endpoints !== undefined ? readString(endpoints['api']) : undefined) ??
    (endpoints !== undefined ? readString(endpoints['proxy-ep']) : undefined) ??
    readString(payload['proxy-ep']);
  if (raw === undefined || raw.length === 0) return GITHUB_COPILOT_API_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function parseExpiresAtSec(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

function parseTidExp(token: string): number | undefined {
  const match = /(?:^|;)exp=(\d+)/.exec(token);
  if (match?.[1] === undefined) return undefined;
  const exp = Number(match[1]);
  return Number.isFinite(exp) && exp > 0 ? exp : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function quotaLabel(key: string): string {
  if (key === 'premium_interactions') return 'Premium interactions';
  if (key === 'chat') return 'Chat';
  if (key === 'completions') return 'Completions';
  return key.replaceAll('_', ' ').replaceAll(/\b\w/g, (ch) => ch.toUpperCase());
}
