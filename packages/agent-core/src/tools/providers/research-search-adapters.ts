import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';

export class SearchRateLimitError extends Error {
  override readonly name = 'SearchRateLimitError';
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} rate limited: HTTP ${String(status)}`);
  }
}

export function rateLimitError(provider: string, status: number): SearchRateLimitError {
  return new SearchRateLimitError(provider, status);
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof SearchRateLimitError) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Polite client id for paid search HTTP adapters. */
export const RESEARCH_SEARCH_USER_AGENT = 'SuperLiora research-search (+https://superliora.dev)';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function buildResult(input: {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly date?: string | undefined;
  readonly content?: string | undefined;
}): WebSearchResult {
  const out: WebSearchResult = {
    title: input.title,
    url: input.url,
    snippet: input.snippet,
  };
  if (input.date !== undefined && input.date.length > 0) out.date = input.date;
  if (input.content !== undefined && input.content.length > 0) out.content = input.content;
  return out;
}

function hasUsableUrl(result: WebSearchResult): boolean {
  try {
    const parsed = new URL(result.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export class SearxngSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const url = new URL('/search', this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 429) throw rateLimitError('searxng', response.status);
    if (response.status >= 400) {
      throw new Error(`SearXNG search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const results = json.results ?? [];
    return results
      .slice(0, limit)
      .map((entry) =>
        buildResult({
          title: stringValue(entry['title']) ?? 'SearXNG result',
          url: stringValue(entry['url']) ?? '',
          snippet: stringValue(entry['content']) ?? '',
          date: stringValue(entry['publishedDate']) ?? stringValue(entry['published_date']),
        }),
      )
      .filter(hasUsableUrl);
  }
}

export class BraveSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
    });
    if (response.status === 429) throw rateLimitError('brave', response.status);
    if (response.status >= 400) {
      throw new Error(`Brave search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      web?: { results?: Array<Record<string, unknown>> };
    };
    const results = json.web?.results ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Brave result',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['description']) ?? '',
        date: stringValue(entry['age']) ?? stringValue(entry['page_age']),
      }),
    ).filter(hasUsableUrl);
  }
}

export class TavilySearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const response = await this.fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: limit,
        // Always basic metadata here; full bodies are attached once after ranking.
        search_depth: 'basic',
        include_raw_content: false,
        include_answer: false,
      }),
    });
    if (response.status === 429) throw rateLimitError('tavily', response.status);
    if (response.status >= 400) {
      throw new Error(`Tavily search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = json.results ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Tavily result',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['content']) ?? '',
        date: stringValue(entry['published_date']),
        content:
          typeof entry['raw_content'] === 'string' && entry['raw_content'].trim().length > 0
            ? entry['raw_content']
            : undefined,
      }),
    ).filter(hasUsableUrl);
  }
}

export class ExaSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const response = await this.fetchImpl('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: limit,
        type: 'auto',
        // Highlights only — full text is fetched selectively after ranking.
        contents: { highlights: true },
      }),
    });
    if (response.status === 429) throw rateLimitError('exa', response.status);
    if (response.status >= 400) {
      throw new Error(`Exa search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = json.results ?? [];
    return results.slice(0, limit).map((entry) => {
      const highlights = Array.isArray(entry['highlights'])
        ? entry['highlights'].filter((h): h is string => typeof h === 'string').join(' … ')
        : '';
      return buildResult({
        title: stringValue(entry['title']) ?? 'Exa result',
        url: stringValue(entry['url']) ?? stringValue(entry['id']) ?? '',
        snippet: highlights || (stringValue(entry['text'])?.slice(0, 400) ?? ''),
        date: stringValue(entry['publishedDate']),
        content: options?.includeContent === true ? stringValue(entry['text']) : undefined,
      });
    }).filter(hasUsableUrl);
  }
}

export class GoogleCseSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly cx: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 10);
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(limit));
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': RESEARCH_SEARCH_USER_AGENT,
      },
    });
    if (response.status === 429) throw rateLimitError('google_cse', response.status);
    if (response.status >= 400) {
      throw new Error(`Google CSE search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      items?: Array<Record<string, unknown>>;
    };
    const results = json.items ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Google CSE result',
        url: stringValue(entry['link']) ?? '',
        snippet: stringValue(entry['snippet']) ?? '',
      }),
    ).filter(hasUsableUrl);
  }
}

/** DuckDuckGo Instant Answer API JSON shape (subset). */
export interface DuckDuckGoInstantAnswerJson {
  readonly AbstractText?: string | undefined;
  readonly AbstractURL?: string | undefined;
  readonly Heading?: string | undefined;
  readonly RelatedTopics?: readonly unknown[] | undefined;
  readonly Results?: readonly unknown[] | undefined;
}

function flattenDuckDuckGoRelatedTopics(
  topics: readonly unknown[],
): ReadonlyArray<{ readonly text: string; readonly url: string }> {
  const items: Array<{ text: string; url: string }> = [];
  for (const entry of topics) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (Array.isArray(record['Topics'])) {
      items.push(...flattenDuckDuckGoRelatedTopics(record['Topics'] as readonly unknown[]));
      continue;
    }
    const text = stringValue(record['Text']);
    const url = stringValue(record['FirstURL']);
    if (text !== undefined && url !== undefined) {
      items.push({ text, url });
    }
  }
  return items;
}

/** Parse DDG Instant Answer JSON into ranked web hits (exported for unit tests). */
export function parseDuckDuckGoInstantAnswerResponse(
  json: DuckDuckGoInstantAnswerJson,
  limit: number,
): WebSearchResult[] {
  const capped = clampInt(limit, 1, 20);
  const out: WebSearchResult[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string, snippet: string): void => {
    if (out.length >= capped) return;
    const candidate = buildResult({ title, url, snippet });
    if (!hasUsableUrl(candidate)) return;
    if (seen.has(candidate.url)) return;
    seen.add(candidate.url);
    out.push(candidate);
  };

  const abstractText = stringValue(json.AbstractText) ?? '';
  const abstractUrl = stringValue(json.AbstractURL) ?? '';
  const heading = stringValue(json.Heading) ?? '';
  if (abstractUrl.length > 0) {
    push(
      heading.length > 0 ? heading : 'DuckDuckGo instant answer',
      abstractUrl,
      abstractText,
    );
  }

  for (const { text, url } of flattenDuckDuckGoRelatedTopics(json.RelatedTopics ?? [])) {
    push(text.slice(0, 120) || 'Related topic', url, text);
    if (out.length >= capped) break;
  }

  for (const entry of json.Results ?? []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const text = stringValue(record['Text']);
    const url = stringValue(record['FirstURL']);
    if (text !== undefined && url !== undefined) {
      push(text.slice(0, 120) || 'DuckDuckGo result', url, text);
    }
    if (out.length >= capped) break;
  }

  return out;
}

export class DuckDuckGoInstantAnswerSearchAdapter implements WebSearchProvider {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '0');
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': RESEARCH_SEARCH_USER_AGENT,
      },
    });
    if (response.status === 429) throw rateLimitError('duckduckgo_ia', response.status);
    if (response.status >= 400) {
      throw new Error(`DuckDuckGo Instant Answer search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as DuckDuckGoInstantAnswerJson;
    return parseDuckDuckGoInstantAnswerResponse(json, limit);
  }
}

export class BingSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 50);
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'User-Agent': RESEARCH_SEARCH_USER_AGENT,
      },
    });
    if (response.status === 429) throw rateLimitError('bing', response.status);
    if (response.status >= 400) {
      throw new Error(`Bing search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      webPages?: { value?: Array<Record<string, unknown>> };
    };
    const results = json.webPages?.value ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['name']) ?? 'Bing result',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['snippet']) ?? '',
        date: stringValue(entry['dateLastCrawled']),
      }),
    ).filter(hasUsableUrl);
  }
}

export class SerperSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const response = await this.fetchImpl('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': this.apiKey,
      },
      body: JSON.stringify({ q: query, num: limit }),
    });
    if (response.status === 429) throw rateLimitError('serper', response.status);
    if (response.status >= 400) {
      throw new Error(`Serper search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      organic?: Array<Record<string, unknown>>;
    };
    const results = json.organic ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Serper result',
        url: stringValue(entry['link']) ?? '',
        snippet: stringValue(entry['snippet']) ?? '',
        date: stringValue(entry['date']),
      }),
    ).filter(hasUsableUrl);
  }
}
