import {
  ensureGitHubCopilotSession,
  GITHUB_COPILOT_API_BASE_URL,
  GITHUB_COPILOT_USER_URL,
  githubCopilotRequestHeaders,
  isGitHubCopilotSessionToken,
  parseGitHubCopilotQuotaSnapshots,
} from '../profiles/github-copilot';
import { providerDisplayName } from './provider-usage-display';
import { headerNum, headerResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

export async function fetchGitHubCopilotUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const limits: ProviderUsageRow[] = [];
    if (!isGitHubCopilotSessionToken(accessToken)) {
      const userRows = await fetchUserQuota(accessToken, controller.signal);
      limits.push(...userRows);
    }
    try {
      const session = await ensureGitHubCopilotSession(accessToken);
      const host = (baseUrl ?? session.apiBaseUrl ?? GITHUB_COPILOT_API_BASE_URL).replace(/\/+$/, '');
      const modelRows = await fetchModelsRateLimit(host, session.token, controller.signal);
      limits.push(...modelRows);
    } catch {
      // Session exchange /models is best-effort when /user already returned rows.
    }
    const summary = limits[0] ?? null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: summary === null ? limits : limits.slice(1),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUserQuota(
  userToken: string,
  signal: AbortSignal,
): Promise<readonly ProviderUsageRow[]> {
  const res = await fetch(GITHUB_COPILOT_USER_URL, {
    headers: {
      Authorization: `token ${userToken}`,
      Accept: 'application/json',
      ...githubCopilotRequestHeaders(),
    },
    signal,
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Token expired. Try /login.');
    }
    throw new Error(`HTTP ${String(res.status)}`);
  }
  const rows = parseGitHubCopilotQuotaSnapshots(await res.json());
  return rows
    .filter((row) => !row.unlimited)
    .map((row) => ({ label: row.label, used: row.used, limit: row.limit }));
}

async function fetchModelsRateLimit(
  apiBaseUrl: string,
  sessionToken: string,
  signal: AbortSignal,
): Promise<readonly ProviderUsageRow[]> {
  const res = await fetch(`${apiBaseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Accept: 'application/json',
      ...githubCopilotRequestHeaders(),
    },
    signal,
  });
  if (!res.ok) return [];
  const limits: ProviderUsageRow[] = [];
  const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
  const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
  if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
    limits.push({
      label: 'Requests',
      used: reqLimit - reqRemaining,
      limit: reqLimit,
      resetHint: headerResetHint(res, 'x-ratelimit-reset-requests'),
    });
  }
  const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
  const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
  if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
    limits.push({
      label: 'Tokens/min',
      used: tokLimit - tokRemaining,
      limit: tokLimit,
      resetHint: headerResetHint(res, 'x-ratelimit-reset-tokens'),
    });
  }
  return limits;
}
