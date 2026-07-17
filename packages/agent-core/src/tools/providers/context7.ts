import { Context7, Context7Error, type Documentation, type Library } from '@upstash/context7-sdk';

export interface Context7LibraryMatch {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly totalSnippets: number;
  readonly trustScore: number;
  readonly benchmarkScore: number;
  readonly versions?: readonly string[];
}

export interface Context7Documentation {
  readonly title: string;
  readonly content: string;
  readonly source: string;
}

export interface Context7Provider {
  searchLibrary(
    query: string,
    libraryName: string,
    options?: { toolCallId?: string },
  ): Promise<Context7LibraryMatch[]>;
  getContext(
    query: string,
    libraryId: string,
    options?: { toolCallId?: string },
  ): Promise<Context7Documentation[]>;
  searchLibraryText(
    query: string,
    libraryName: string,
    options?: { toolCallId?: string },
  ): Promise<string>;
  getContextText(
    query: string,
    libraryId: string,
    options?: { toolCallId?: string },
  ): Promise<string>;
}

export { Context7Error };

/** Keep library resolution short — models only need a few IDs to pick from. */
const CONTEXT7_RESOLVE_MAX_MATCHES = 8;
/** Cap each doc snippet so getContext cannot dump multi-page bodies. */
const CONTEXT7_DOC_CONTENT_MAX_CHARS = 4_000;
/** Cap aggregate getContextText payload before ToolResultBuilder. */
const CONTEXT7_DOCS_TEXT_MAX_CHARS = 12_000;

function toLibraryMatch(library: Library): Context7LibraryMatch {
  return {
    id: library.id,
    name: library.name,
    description: library.description,
    totalSnippets: library.totalSnippets,
    trustScore: library.trustScore,
    benchmarkScore: library.benchmarkScore,
    versions: library.versions,
  };
}

function toDocumentation(doc: Documentation): Context7Documentation {
  const content =
    doc.content.length > CONTEXT7_DOC_CONTENT_MAX_CHARS
      ? `${doc.content.slice(0, CONTEXT7_DOC_CONTENT_MAX_CHARS)}…`
      : doc.content;
  return {
    title: doc.title,
    content,
    source: doc.source,
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated at ${String(maxChars)} of ${String(text.length)} chars — narrow the query]`;
}

function formatLibraryMatches(matches: readonly Context7LibraryMatch[]): string {
  if (matches.length === 0) return 'No libraries found for that name.';
  return matches
    .map((m, i) => {
      const versions =
        m.versions !== undefined && m.versions.length > 0
          ? `\n- Versions: ${m.versions.slice(0, 6).join(', ')}${m.versions.length > 6 ? '…' : ''}`
          : '';
      return [
        `${String(i + 1)}. ${m.name}`,
        `- Context7-compatible library ID: ${m.id}`,
        `- Description: ${m.description}`,
        `- Snippets: ${String(m.totalSnippets)} · trust ${String(m.trustScore)} · bench ${String(m.benchmarkScore)}${versions}`,
      ].join('\n');
    })
    .join('\n\n');
}

function formatDocumentation(docs: readonly Context7Documentation[]): string {
  if (docs.length === 0) return 'No documentation snippets matched that query.';
  return docs
    .map((d) => `## ${d.title}\nSource: ${d.source}\n\n${d.content}`)
    .join('\n\n---\n\n');
}


export class SdkContext7Provider implements Context7Provider {
  private readonly client: Context7;

  constructor(config: { apiKey: string }) {
    this.client = new Context7({ apiKey: config.apiKey });
  }

  async searchLibrary(
    query: string,
    libraryName: string,
    _options?: { toolCallId?: string },
  ): Promise<Context7LibraryMatch[]> {
    const results = await this.client.searchLibrary(query, libraryName, { type: 'json' });
    return results.map(toLibraryMatch).slice(0, CONTEXT7_RESOLVE_MAX_MATCHES);
  }

  async searchLibraryText(
    query: string,
    libraryName: string,
    options?: { toolCallId?: string },
  ): Promise<string> {
    // Prefer structured JSON + compact render so we can enforce match caps and
    // avoid unbounded SDK txt dumps thrashing long sessions.
    const matches = await this.searchLibrary(query, libraryName, options);
    return formatLibraryMatches(matches);
  }

  async getContext(
    query: string,
    libraryId: string,
    _options?: { toolCallId?: string },
  ): Promise<Context7Documentation[]> {
    const results = await this.client.getContext(query, libraryId, { type: 'json' });
    return results.map(toDocumentation).slice(0, CONTEXT7_RESOLVE_MAX_MATCHES);
  }

  async getContextText(
    query: string,
    libraryId: string,
    options?: { toolCallId?: string },
  ): Promise<string> {
    const docs = await this.getContext(query, libraryId, options);
    return truncateText(formatDocumentation(docs), CONTEXT7_DOCS_TEXT_MAX_CHARS);
  }
}

const BRACKETED_PASTE_START = '\u001B[200~';
const BRACKETED_PASTE_END = '\u001B[201~';
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) strips pasted terminal control sequences
const ANSI_CSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function sanitizeApiKeyValue(value: string): string {
  return value
    .replaceAll(BRACKETED_PASTE_START, '')
    .replaceAll(BRACKETED_PASTE_END, '')
    .replace(ANSI_CSI, '')
    .trim();
}

export function resolveContext7ApiKey(input: {
  readonly apiKey?: string | undefined;
  readonly apiKeyEnv?: string | undefined;
}): string | undefined {
  if (input.apiKey !== undefined) {
    const sanitized = sanitizeApiKeyValue(input.apiKey);
    if (sanitized.length > 0) return sanitized;
  }
  const envName = input.apiKeyEnv ?? 'CONTEXT7_API_KEY';
  const fromEnv = process.env[envName];
  if (fromEnv === undefined) return undefined;
  const sanitized = sanitizeApiKeyValue(fromEnv);
  return sanitized.length > 0 ? sanitized : undefined;
}
