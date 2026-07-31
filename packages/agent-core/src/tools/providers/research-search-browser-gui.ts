import type { BrowserUseRuntime } from '@superliora/gui-use';

import type { WebSearchResult } from '../builtin/web/web-search';
import { parseDuckDuckGoResults } from './local-web-search-ddg-parse';
import { buildResult, prefixedSnippet } from './local-web-search-shared';
import type { BrowserSearchChannel } from './research-search-browser';
import { HintBrowserSearchChannel } from './research-search-browser';

export const DDG_HTML_BROWSER_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface GuiUseBrowserSearchChannelOptions {
  readonly timeoutMs?: number | undefined;
  readonly searchUrl?: string | undefined;
}

export class GuiUseBrowserSearchChannel implements BrowserSearchChannel {
  constructor(
    private readonly runtime: BrowserUseRuntime | undefined,
    private readonly options: GuiUseBrowserSearchChannelOptions = {},
  ) {}

  available(): boolean {
    return this.runtime !== undefined;
  }

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    if (this.runtime === undefined) return [];
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() =>{  controller.abort(); }, timeoutMs);

    try {
      const status = await this.runtime.status({ installIfMissing: false }, controller.signal);
      if (status.ready !== true) return [];

      const url = buildDuckDuckGoSearchUrl(trimmed, this.options.searchUrl ?? DDG_HTML_BROWSER_SEARCH_URL);
      const observation = await this.runtime.observe({ url }, controller.signal);
      if (!observation.ok) return [];

      const page = await this.runtime.console(
        { expression: 'document.documentElement.outerHTML' },
        controller.signal,
      );
      if (!page.ok || typeof page.result !== 'string' || page.result.trim().length === 0) {
        return [];
      }

      const parsed = parseDuckDuckGoResults(page.result, limit);
      return parsed.map((result) =>
        buildResult({
          title: result.title,
          url: result.url,
          snippet: prefixedSnippet('browser', result.snippet),
          date: result.date,
        }),
      );
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function createBrowserSearchChannel(
  browserUse: BrowserUseRuntime | undefined,
  browserUseEnabled: boolean,
): Promise<BrowserSearchChannel> {
  if (browserUse === undefined) {
    return new HintBrowserSearchChannel(browserUseEnabled);
  }
  try {
    const status = await browserUse.status({ installIfMissing: false });
    if (status.ready === true) {
      return new GuiUseBrowserSearchChannel(browserUse);
    }
  } catch {
    // Fall back to hint channel below.
  }
  return new HintBrowserSearchChannel(browserUseEnabled);
}

function buildDuckDuckGoSearchUrl(query: string, baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('q', query);
  if (!url.searchParams.has('kl')) url.searchParams.set('kl', 'wt-wt');
  if (!url.searchParams.has('kp')) url.searchParams.set('kp', '-2');
  return url.toString();
}
