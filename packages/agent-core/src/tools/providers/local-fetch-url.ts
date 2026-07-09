/**
 * LocalFetchURLProvider — host-side URL fetcher.
 *
 * Flow:
 *   1. GET the URL with a Chrome-like UA.
 *   2. Reject HTTP >= 400 with the status code in the message.
 *   3. Reject responses larger than `maxBytes` (content-length first,
 *      then measured body length as a defensive second check).
 *   4. `text/plain` / `text/markdown` → passthrough verbatim.
 *   5. Otherwise (assumed HTML) → extract the main text through the
 *      built-in research extractor: common documentation/content selectors,
 *      then Readability, then `<body>` as the last fallback.
 */

import { promises as dns } from 'node:dns';

import { Readability } from '@mozilla/readability';
import { parseHTML as rawParseHTML } from 'linkedom';

import { HttpFetchError, type UrlFetcher, type UrlFetchResult } from '../builtin';

// Readability's .d.ts references the global `Document` type, but this
// package compiles with `lib: ES2023` (no DOM). Extracting the
// constructor parameter type keeps us off the global `Document` name
// while still accepting whatever Readability wants.
type ReadabilityDocument = ConstructorParameters<typeof Readability>[0];

// linkedom's published types depend on DOM libs we don't load. Declare
// the minimal surface we actually use so the rest of the file stays
// type-safe without pulling lib.dom.d.ts into the host build.
interface DomElementLike {
  textContent: string | null;
  querySelector(selector: string): DomElementLike | null;
  querySelectorAll(selector: string): Iterable<DomElementLike>;
}
interface DomParseResult {
  document: DomElementLike;
}
const parseHTML = rawParseHTML as unknown as (html: string) => DomParseResult;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MIN_SELECTOR_TEXT_LENGTH = 20;

export const LOCAL_WEB_RESEARCH_CONTENT_SELECTORS = Object.freeze([
  'article',
  'main',
  '[role="main"]',
  '.markdown-body',
  '.docs-content',
  '.doc-content',
  '.documentation',
  '.post-content',
  '.entry-content',
  '#content',
] as const);

export interface LocalMainContentExtraction {
  readonly content: string;
  readonly source: 'selector' | 'readability' | 'body';
  readonly selector?: string;
}

export interface LocalFetchURLProviderOptions {
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  /**
   * Allow fetching loopback / RFC 1918 / link-local / ULA addresses.
   * Defaults to `false` — enabled only for tests and (future) explicit
   * opt-in. Keeps an LLM that's been prompt-injected from exfiltrating
   * AWS/GCP metadata (169.254.169.254), probing internal services
   * (10.x, 192.168.x), or reading local daemons (127.0.0.1:*).
   */
  allowPrivateAddresses?: boolean;
  /**
   * Resolve the hostname via `node:dns` and reject if any resolved address
   * is private / loopback / link-local / ULA. Defends against DNS rebinding
   * (a public-looking domain that resolves to an internal IP). Defaults to
   * `true`; disabled only for tests that inject a fake fetcher.
   */
  resolveDns?: boolean;
  /**
   * Maximum HTTP redirect hops to follow. Each hop is re-validated through
   * the full static + DNS SSRF guard. Defaults to 5.
   */
  maxRedirects?: number;
}

/**
 * True when the IP literal is private / loopback / link-local / ULA / CGNAT.
 * Handles IPv4 dotted-quad, IPv6 loopback/ULA/link-local, and IPv6-mapped IPv4
 * (`::ffff:127.0.0.1`). Returns false for non-IP strings (domain names).
 */
export function isPrivateIp(address: string): boolean {
  const host = address.toLowerCase();
  // Literal "localhost" / loopback aliases.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // Strip IPv6-mapped IPv4: `::ffff:127.0.0.1` → `127.0.0.1`.
  const mappedV4 = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (mappedV4 !== null) return isPrivateIp(mappedV4[1]!);

  // IPv6 loopback / ULA / link-local. `fc`/`fd` are ULA (fc00::/7);
  // `fe80` is link-local; `::1` loopback; `::` unspecified.
  if (host === '::1' || host === '::') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  // IPv4 literal — only check when the hostname is a dotted-quad.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 === null) return false;
  const octets = [v4[1], v4[2], v4[3], v4[4]].map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  // 127.0.0.0/8 loopback, 10.0.0.0/8, 192.168.0.0/16,
  // 172.16.0.0/12, 169.254.0.0/16 link-local / AWS metadata,
  // 0.0.0.0/8 "this network", 100.64.0.0/10 CGNAT.
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * SSRF guard — reject non-http(s) schemes and (by default) any hostname
 * that is, or resolves to, a private / loopback / link-local / ULA address.
 *
 * Two layers:
 *   1. Static URL-string check (scheme + IP literal / localhost hostname).
 *   2. DNS resolution (when `resolveDns` is true) — reject if any resolved
 *      address is private. Closes the DNS-rebinding window where a public
 *      domain resolves to an internal IP.
 */
async function assertSafeFetchTarget(
  url: string,
  allowPrivate: boolean,
  resolveDns: boolean,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" — only http(s) allowed.`);
  }
  // Reject URLs with embedded credentials (`user:pass@host`).
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`Refusing to fetch URL with embedded credentials: "${parsed.origin}"`);
  }
  if (allowPrivate) return;
  // URL hostname preserves surrounding `[ ]` for IPv6 literals on some
  // Node versions (and not others). Strip them for uniform comparison.
  const hostRaw = parsed.hostname.toLowerCase();
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']') ? hostRaw.slice(1, -1) : hostRaw;
  if (isPrivateIp(host)) {
    throw new Error(`Refusing to fetch private host: "${host}"`);
  }
  // For domain names (non-IP-literal), resolve and check each address to
  // defend against DNS rebinding. Skip for IP literals already checked above.
  if (!resolveDns || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return;
  try {
    const resolved = await dns.lookup(host, { all: true });
    for (const entry of resolved) {
      if (isPrivateIp(entry.address)) {
        throw new Error(
          `Refusing to fetch "${host}": resolves to private address "${entry.address}".`,
        );
      }
    }
  } catch (error) {
    // Re-throw our own rejection; surface DNS failures as-is (they will
    // surface again as a fetch error, which is the correct behavior).
    if (error instanceof Error && error.message.startsWith('Refusing to fetch')) throw error;
  }
}

export class LocalFetchURLProvider implements UrlFetcher {
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly allowPrivateAddresses: boolean;
  private readonly resolveDns: boolean;
  private readonly maxRedirects: number;

  constructor(options: LocalFetchURLProviderOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.allowPrivateAddresses = options.allowPrivateAddresses ?? false;
    this.resolveDns = options.resolveDns ?? true;
    this.maxRedirects = options.maxRedirects ?? 5;
  }

  async fetch(url: string, _options?: { toolCallId?: string }): Promise<UrlFetchResult> {
    // Follow redirects manually so every hop is re-validated through the
    // full static + DNS SSRF guard. A first-hop-safe URL that 302s to an
    // internal service must still be blocked.
    let currentUrl = url;
    let response: Response | undefined;
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      await assertSafeFetchTarget(currentUrl, this.allowPrivateAddresses, this.resolveDns);
      response = await this.fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': this.userAgent },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      // Drain the redirect response body before continuing.
      await response.body?.cancel().catch(() => {
        /* already closed */
      });
      if (location === null) break;
      currentUrl = new URL(location, currentUrl).toString();
    }
    if (response === undefined) {
      throw new Error(`Too many redirects (>${String(this.maxRedirects)}) fetching "${url}".`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Too many redirects (>${String(this.maxRedirects)}) fetching "${url}".`);
    }
    if (response.status >= 400) {
      // Drain the unused body so undici can release the socket back to
      // the keep-alive pool instead of leaking it on error paths.
      await response.body?.cancel().catch(() => {
        /* already closed */
      });
      throw new HttpFetchError(
        response.status,
        `HTTP ${String(response.status)} ${response.statusText}`,
      );
    }

    // Reject oversized responses before buffering the full body.
    const contentLengthRaw = response.headers.get('content-length');
    if (contentLengthRaw !== null) {
      const cl = Number(contentLengthRaw);
      if (Number.isFinite(cl) && cl > this.maxBytes) {
        throw new Error(
          `Response body too large: ${String(cl)} bytes exceeds maxBytes (${String(this.maxBytes)}).`,
        );
      }
    }

    const body = await response.text();

    // Servers may omit content-length — measure again defensively.
    const actualBytes = Buffer.byteLength(body, 'utf8');
    if (actualBytes > this.maxBytes) {
      throw new Error(
        `Response body too large: ${String(actualBytes)} bytes exceeds maxBytes (${String(this.maxBytes)}).`,
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.startsWith('text/plain') || contentType.startsWith('text/markdown')) {
      return { content: body, kind: 'passthrough' };
    }

    return { content: extractLocalMainContent(body).content, kind: 'extracted' };
  }
}

export function extractLocalMainContent(html: string): LocalMainContentExtraction {
  const selector = extractByContentSelector(html);
  if (selector !== undefined) return selector;

  const readability = extractByReadability(html);
  if (readability !== undefined) return readability;

  const { document } = parseHTML(html);
  const titleText = normalizeText(document.querySelector('title')?.textContent ?? '');
  const fallbackText = normalizeText(document.querySelector('body')?.textContent ?? '');

  if (fallbackText.length === 0) {
    throw new Error(
      'Failed to extract meaningful content from the page. The page may require JavaScript to render.',
    );
  }

  return {
    content: withTitle(titleText, fallbackText),
    source: 'body',
  };
}

function extractByContentSelector(html: string): LocalMainContentExtraction | undefined {
  const { document } = parseHTML(html);
  const titleText = normalizeText(document.querySelector('title')?.textContent ?? '');
  let best: { selector: string; text: string } | undefined;

  for (const selector of LOCAL_WEB_RESEARCH_CONTENT_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const text = normalizeText(element.textContent ?? '');
      if (text.length < MIN_SELECTOR_TEXT_LENGTH) continue;
      if (best === undefined || text.length > best.text.length) {
        best = { selector, text };
      }
    }
  }

  if (best === undefined) return undefined;
  return {
    content: withTitle(titleText, best.text),
    source: 'selector',
    selector: best.selector,
  };
}

function extractByReadability(html: string): LocalMainContentExtraction | undefined {
  const primary = parseHTML(html);
  try {
    const reader = new Readability(primary.document as unknown as ReadabilityDocument, {
      charThreshold: 0,
    });
    const article = reader.parse();
    if (article !== null) {
      const text = normalizeText(article.textContent ?? '');
      if (text.length > 0) {
        const title = normalizeText(article.title ?? '');
        return {
          content: withTitle(title, text),
          source: 'readability',
        };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function withTitle(title: string, text: string): string {
  return title.length > 0 ? `# ${title}\n\n${text}` : text;
}
