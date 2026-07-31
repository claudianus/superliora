import type { WebSearchResult } from '../builtin/web/web-search';
import { buildResult, prefixedSnippet } from './local-web-search-shared';
import type { BrowserSearchChannel } from './research-search-browser';
import {
  buildResearchBridgeStatus,
  CHROME_EXT_BRIDGE_ENV,
  CHROME_EXT_URL_ENV,
  CHROME_RESEARCH_BRIDGE_ENV,
  DEFAULT_CHROME_EXT_BRIDGE_URL,
  isResearchBridgeEnabled,
  researchBridgeCh5Tip,
  resolveResearchBridgeUrl,
  type ResearchBridgeStatus,
} from './research-bridge-status';

export {
  CHROME_EXT_BRIDGE_ENV,
  CHROME_EXT_URL_ENV,
  CHROME_RESEARCH_BRIDGE_ENV,
  DEFAULT_CHROME_EXT_BRIDGE_URL,
  isResearchBridgeEnabled as isChromeExtensionBridgeEnabled,
  researchBridgeCh5Tip,
  resolveResearchBridgeUrl as resolveChromeExtensionBridgeUrl,
};
const DEFAULT_TIMEOUT_MS = 3_000;

export interface ChromeExtensionBridgeResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface ChromeExtensionBridgeResponse {
  readonly results?: readonly ChromeExtensionBridgeResult[] | undefined;
}

export type ChromeExtensionBridgeStatus = ResearchBridgeStatus;

export interface ChromeExtensionSearchChannelOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

/** Snapshot for engine status / TUI — env gate + soft native-host handshake. */
export function buildChromeExtensionBridgeStatus(
  env: NodeJS.ProcessEnv = process.env,
  options?: { readonly configured?: boolean | undefined },
): ChromeExtensionBridgeStatus {
  return buildResearchBridgeStatus({ env, configured: options?.configured });
}

/** Soft-degrade hint when Ch5 was attempted but returned no hits (never-empty path). */
export function chromeExtensionDegradeHint(): string {
  return (
    'Chrome extension search bridge returned no hits. ' +
    'Ensure native-messaging host handshake + localhost bridge are connected, ' +
    'or continue with FetchURL / local repo evidence.'
  );
}

export class ChromeExtensionSearchChannel implements BrowserSearchChannel {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private escalateAttemptedFlag = false;

  constructor(options: ChromeExtensionSearchChannelOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  available(): boolean {
    return buildChromeExtensionBridgeStatus(this.env).ready;
  }

  /** Env-gated bridge snapshot for ResearchSearchEngine.status(). */
  status(): ChromeExtensionBridgeStatus {
    return buildChromeExtensionBridgeStatus(this.env);
  }

  get escalateAttempted(): boolean {
    return this.escalateAttemptedFlag;
  }

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    if (!this.available()) return [];

    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    this.escalateAttemptedFlag = true;
    const bridgeUrl = resolveResearchBridgeUrl(this.env);
    const controller = new AbortController();
    const timeout = setTimeout(() =>{  controller.abort(); }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(bridgeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: trimmed, limit }),
        signal: controller.signal,
      });
      if (!response.ok) return [];

      const payload = (await response.json()) as ChromeExtensionBridgeResponse;
      const rows = payload.results;
      if (!Array.isArray(rows)) return [];

      return rows
        .slice(0, limit)
        .filter(
          (row): row is ChromeExtensionBridgeResult =>
            typeof row?.title === 'string' &&
            typeof row?.url === 'string' &&
            typeof row?.snippet === 'string',
        )
        .map((row) =>
          buildResult({
            title: row.title.trim(),
            url: row.url.trim(),
            snippet: prefixedSnippet('chrome-ext', row.snippet.trim()),
          }),
        )
        .filter((row) => row.title.length > 0 && row.url.length > 0);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createChromeExtensionSearchChannel(
  options: ChromeExtensionSearchChannelOptions = {},
): BrowserSearchChannel {
  return new ChromeExtensionSearchChannel(options);
}
