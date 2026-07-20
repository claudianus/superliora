/**
 * `/web` content fetching — pull a URL and turn it into readable plain text
 * for the TUI file viewer.
 *
 * HTML is structurally extracted without a DOM library (Readability/lynx
 * style): chrome elements (script, style, nav, footer, …) are dropped with
 * their content, headings and list items become plain-text markers, links are
 * annotated with their href. Other text-like content types pass through as
 * raw text.
 */

/** Default abort timeout for `/web` fetches. */
export const WEB_FETCH_TIMEOUT_MS = 10_000;

/** Default body size cap in bytes; larger bodies are cut and flagged. */
export const WEB_FETCH_MAX_BYTES = 1_000_000;

export interface WebContent {
  readonly url: string;
  readonly title?: string;
  readonly contentType: string;
  readonly body: string;
  readonly truncated: boolean;
}

export interface FetchWebContentOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Normalize user input into an absolute http(s) URL. Adds `https://` when no
 * scheme is present. Returns undefined for empty input, unparseable URLs, and
 * non-http(s) schemes (file:, javascript:, …).
 */
const NON_WEB_SCHEME = /^(?:about|blob|chrome|data|file|ftp|javascript):/i;

export function normalizeWebUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const direct = tryParseUrl(trimmed);
  if (direct !== undefined && (direct.protocol === 'http:' || direct.protocol === 'https:')) {
    return direct.href;
  }
  if (NON_WEB_SCHEME.test(trimmed)) return undefined;
  // Schemeless input (`example.com`) and bare host:port input
  // (`localhost:58627`, which URL misreads as a bogus scheme) get an
  // explicit https:// retry.
  const prefixed = tryParseUrl(`https://${trimmed}`);
  if (prefixed !== undefined && (prefixed.protocol === 'http:' || prefixed.protocol === 'https:')) {
    return prefixed.href;
  }
  return undefined;
}

/**
 * Fetch `rawUrl` and return readable content. HTML is converted via
 * {@link htmlToReadableText}; other text-like types pass through. Throws on
 * invalid URLs, timeouts, non-2xx responses, oversized-unsupported types, and
 * content types that are not text-like.
 */
export async function fetchWebContent(
  rawUrl: string,
  opts?: FetchWebContentOptions,
): Promise<WebContent> {
  const url = normalizeWebUrl(rawUrl);
  if (url === undefined) {
    throw new Error(`Invalid URL: ${rawUrl.trim().length > 0 ? rawUrl.trim() : '(empty)'}`);
  }
  const timeoutMs = opts?.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? WEB_FETCH_MAX_BYTES;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${String(timeoutMs)}ms fetching ${url}`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} fetching ${url}`);
  }

  const contentType = (response.headers.get('content-type') ?? 'application/octet-stream')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (contentType === undefined || contentType.length === 0) {
    throw new Error('Missing content type');
  }

  const { text, truncated } = await readBodyWithCap(response, maxBytes);

  if (contentType === 'text/html' || contentType.startsWith('application/xhtml')) {
    const readable = htmlToReadableText(text);
    return { url, title: readable.title, contentType, body: readable.text, truncated };
  }
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/xml'
  ) {
    return { url, contentType, body: text, truncated };
  }
  throw new Error(`Unsupported content type: ${contentType}`);
}

/**
 * Convert an HTML document to structured plain text: headings get `#` markers,
 * list items get bullets, links are annotated as `text (href)`, and chrome
 * elements disappear. Returns the document title (`<title>`, else og:title)
 * when present.
 */
export function htmlToReadableText(html: string): { title?: string; text: string } {
  const withoutComments = stripComments(html);
  const title = extractTitle(withoutComments);
  const text = finishText(renderDocument(stripRemovedElements(withoutComments)));
  return { title, text };
}

function tryParseUrl(candidate: string): URL | undefined {
  try {
    return new URL(candidate);
  } catch {
    return undefined;
  }
}

async function readBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const stream = response.body;
  if (stream === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
    return { text: cutToBytes(text, maxBytes), truncated: true };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        const keep = Math.max(0, value.byteLength - (received - maxBytes));
        chunks.push(value.subarray(0, keep));
        truncated = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  return { text, truncated };
}

function cutToBytes(text: string, maxBytes: number): string {
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
}

// ── HTML → plain text ────────────────────────────────────────────────────────

/** Elements removed together with their content (title is read before this). */
const REMOVED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'nav',
  'aside',
  'footer',
  'header',
  'form',
  'head',
];

/** Opening/closing tags that simply break lines. */
const LINE_BREAK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'table',
  'tr',
  'blockquote',
  'ul',
  'ol',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
};

function decodeEntities(text: string): string {
  return text.replaceAll(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(codePoint)) return match;
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function stripComments(html: string): string {
  return html.replaceAll(/<!--[\s\S]*?-->/g, ' ');
}

function stripRemovedElements(html: string): string {
  const names = REMOVED_ELEMENTS.join('|');
  const paired = new RegExp(`<(${names})\\b[^>]*>[\\s\\S]*?<\\/\\1\\b[^>]*>`, 'gi');
  const stray = new RegExp(`</?(?:${names})\\b[^>]*>`, 'gi');
  return html.replace(paired, ' ').replace(stray, ' ');
}

function extractTitle(html: string): string | undefined {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (titleMatch !== null) {
    const title = collapseWhitespace(decodeEntities(titleMatch[1] ?? ''));
    if (title.length > 0) return title;
  }
  for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = meta[0];
    if (!/\b(?:property|name)\s*=\s*(?:"og:title"|'og:title')/i.test(tag)) continue;
    const content = readAttribute(tag, 'content');
    if (content === undefined) continue;
    const title = collapseWhitespace(decodeEntities(content));
    if (title.length > 0) return title;
  }
  return undefined;
}

function tagName(token: string): string | undefined {
  const match = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(token);
  return match?.[1]?.toLowerCase();
}

function readAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = pattern.exec(tag);
  if (match === null) return undefined;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function endLine(out: string): string {
  return out.length === 0 || out.endsWith('\n') ? out : `${out}\n`;
}

/** Ensure `out` ends with a blank line (used around <pre> blocks). */
function endParagraph(out: string): string {
  return out.length === 0 ? out : out.replace(/\n*$/, '\n\n');
}

interface AnchorFrame {
  readonly start: number;
  readonly href: string | undefined;
}

function renderDocument(doc: string): string {
  const tokens = doc.match(/<[^>]+>|[^<]+/g) ?? [];
  let out = '';
  let preDepth = 0;
  const anchors: AnchorFrame[] = [];

  for (const token of tokens) {
    const isTag = token.startsWith('<');

    if (preDepth > 0) {
      if (!isTag) {
        out += decodeEntities(token);
        continue;
      }
      if (token.startsWith('</') && tagName(token) === 'pre') {
        preDepth -= 1;
        if (preDepth === 0) out = endParagraph(out);
      }
      continue;
    }

    if (!isTag) {
      const chunk = collapseWhitespace(decodeEntities(token));
      if (chunk.length === 0) continue;
      out += out.length === 0 || out.endsWith('\n') ? chunk.trimStart() : chunk;
      continue;
    }

    const name = tagName(token);
    if (name === undefined) continue;
    const closing = token.startsWith('</');

    if (closing) {
      if (name === 'a') {
        const frame = anchors.pop();
        if (frame !== undefined && frame.href !== undefined) {
          const href = decodeEntities(frame.href);
          const text = collapseWhitespace(out.slice(frame.start));
          if (/^https?:\/\//i.test(href) && text.length > 0 && text !== href) {
            out += ` (${href})`;
          }
        }
        continue;
      }
      if (name.startsWith('h') && name.length === 2 && name >= 'h1' && name <= 'h6') {
        out = endLine(out);
        continue;
      }
      if (name === 'li' || LINE_BREAK_TAGS.has(name)) out = endLine(out);
      continue;
    }

    switch (name) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        out = endLine(out);
        out += `${'#'.repeat(Number.parseInt(name.slice(1), 10))} `;
        break;
      }
      case 'li':
        out = endLine(out);
        out += '• ';
        break;
      case 'br':
        out += '\n';
        break;
      case 'hr':
        out = endLine(out);
        out += `${'─'.repeat(20)}\n`;
        break;
      case 'pre':
        preDepth += 1;
        out = endParagraph(out);
        break;
      case 'a':
        anchors.push({ start: out.length, href: readAttribute(token, 'href') });
        break;
      case 'img': {
        const alt = readAttribute(token, 'alt');
        if (alt !== undefined) {
          const label = collapseWhitespace(decodeEntities(alt));
          if (label.length > 0) out += `[${label}]`;
        }
        break;
      }
      default:
        if (LINE_BREAK_TAGS.has(name)) out += '\n';
    }
  }
  return out;
}

function finishText(raw: string): string {
  return raw.replaceAll(/[ \t]+$/gm, '').replaceAll(/\n{3,}/g, '\n\n').trim();
}
