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
  return {
    title: doc.title,
    content: doc.content,
    source: doc.source,
  };
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
    return results.map(toLibraryMatch);
  }

  async searchLibraryText(
    query: string,
    libraryName: string,
    _options?: { toolCallId?: string },
  ): Promise<string> {
    return this.client.searchLibrary(query, libraryName, { type: 'txt' });
  }

  async getContext(
    query: string,
    libraryId: string,
    _options?: { toolCallId?: string },
  ): Promise<Context7Documentation[]> {
    const results = await this.client.getContext(query, libraryId, { type: 'json' });
    return results.map(toDocumentation);
  }

  async getContextText(
    query: string,
    libraryId: string,
    _options?: { toolCallId?: string },
  ): Promise<string> {
    return this.client.getContext(query, libraryId, { type: 'txt' });
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
