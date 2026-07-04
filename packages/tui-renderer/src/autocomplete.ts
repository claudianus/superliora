import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { fuzzyFilter } from './fuzzy';

export interface AutocompleteItem {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export type Awaitable<T> = T | Promise<T>;

export interface SlashCommand {
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly getArgumentCompletions?: (argumentPrefix: string) => Awaitable<AutocompleteItem[] | null>;
}

export interface AutocompleteSuggestions {
  readonly items: AutocompleteItem[];
  readonly prefix: string;
}

export interface AutocompleteProvider {
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { readonly signal: AbortSignal; readonly force?: boolean },
  ): Promise<AutocompleteSuggestions | null>;
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number };
  shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

const PATH_DELIMITERS = new Set([' ', '\t', '"', "'", '=']);
const FD_MAX_RESULTS = 100;
const FUZZY_MAX_RESULTS = 20;

interface PathPrefix {
  readonly rawPrefix: string;
  readonly isAtPrefix: boolean;
  readonly isQuotedPrefix: boolean;
}

interface FdEntry {
  readonly path: string;
  readonly isDirectory: boolean;
}

export class CombinedAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly commands: ReadonlyArray<AutocompleteItem | SlashCommand> = [],
    private readonly basePath: string,
    private readonly fdPath: string | null = null,
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { readonly signal: AbortSignal; readonly force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const currentLine = lines[cursorLine] ?? '';
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    const atPrefix = extractAtPrefix(textBeforeCursor);

    if (atPrefix !== null) {
      const { rawPrefix, isQuotedPrefix } = parsePathPrefix(atPrefix);
      const suggestions = await this.getFuzzyFileSuggestions(rawPrefix, {
        isQuotedPrefix,
        signal: options.signal,
      });
      return suggestions.length === 0 ? null : { items: suggestions, prefix: atPrefix };
    }

    if (options.force !== true && textBeforeCursor.startsWith('/')) {
      return this.getSlashSuggestions(textBeforeCursor);
    }

    const pathPrefix = extractPathPrefix(textBeforeCursor, options.force === true);
    if (pathPrefix === null) return null;

    const suggestions = this.getFileSuggestions(pathPrefix);
    return suggestions.length === 0 ? null : { items: suggestions, prefix: pathPrefix };
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number } {
    const currentLine = lines[cursorLine] ?? '';
    const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
    const afterCursor = currentLine.slice(cursorCol);
    const isQuotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"');
    const adjustedAfterCursor =
      isQuotedPrefix && item.value.endsWith('"') && afterCursor.startsWith('"')
        ? afterCursor.slice(1)
        : afterCursor;

    if (isSlashCommandNameCompletion(prefix, beforePrefix)) {
      const nextLine = `${beforePrefix}/${item.value} ${adjustedAfterCursor}`;
      return replaceLine(lines, cursorLine, nextLine, beforePrefix.length + item.value.length + 2);
    }

    if (prefix.startsWith('@')) {
      const isDirectory = item.label.endsWith('/');
      const suffix = isDirectory ? '' : ' ';
      const nextLine = `${beforePrefix}${item.value}${suffix}${adjustedAfterCursor}`;
      return replaceLine(lines, cursorLine, nextLine, beforePrefix.length + completionCursorOffset(item) + suffix.length);
    }

    const nextLine = `${beforePrefix}${item.value}${adjustedAfterCursor}`;
    return replaceLine(lines, cursorLine, nextLine, beforePrefix.length + completionCursorOffset(item));
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    const currentLine = lines[cursorLine] ?? '';
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    return !(textBeforeCursor.trim().startsWith('/') && !textBeforeCursor.trim().includes(' '));
  }

  private async getSlashSuggestions(textBeforeCursor: string): Promise<AutocompleteSuggestions | null> {
    const spaceIndex = textBeforeCursor.indexOf(' ');
    if (spaceIndex === -1) {
      const prefix = textBeforeCursor.slice(1);
      const commandItems = this.commands.map(toCommandSearchItem);
      const filtered = fuzzyFilter(commandItems, prefix, (item) => item.name).map((item) => ({
        value: item.name,
        label: item.label,
        description: item.description,
      }));
      return filtered.length === 0 ? null : { items: filtered, prefix: textBeforeCursor };
    }

    const commandName = textBeforeCursor.slice(1, spaceIndex);
    const argumentText = textBeforeCursor.slice(spaceIndex + 1);
    const command = this.commands.find((item) => commandNameFor(item) === commandName);
    if (command === undefined || !('getArgumentCompletions' in command)) return null;

    const getArgumentCompletions = command.getArgumentCompletions;
    if (getArgumentCompletions === undefined) return null;

    const items = await getArgumentCompletions(argumentText);
    return items === null || items.length === 0 ? null : { items, prefix: argumentText };
  }

  private getFileSuggestions(prefix: string): AutocompleteItem[] {
    try {
      const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(prefix);
      const expandedPrefix = expandHomePath(rawPrefix);
      const { searchDir, searchPrefix } = resolveSearchTarget(this.basePath, rawPrefix, expandedPrefix, isAtPrefix);
      const entries = readdirSync(searchDir, { withFileTypes: true });
      const suggestions: AutocompleteItem[] = [];

      for (const entry of entries) {
        if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) continue;

        let isDirectory = entry.isDirectory();
        if (!isDirectory && entry.isSymbolicLink()) {
          try {
            isDirectory = statSync(join(searchDir, entry.name)).isDirectory();
          } catch {
            // Broken symlink or permission error. Keep it as a file.
          }
        }

        const relativePath = pathForEntry(rawPrefix, expandedPrefix, entry.name);
        const pathValue = isDirectory ? `${relativePath}/` : relativePath;
        suggestions.push({
          value: buildCompletionValue(pathValue, { isAtPrefix, isQuotedPrefix }),
          label: `${entry.name}${isDirectory ? '/' : ''}`,
        });
      }

      suggestions.sort((a, b) => {
        const aIsDir = a.label.endsWith('/');
        const bIsDir = b.label.endsWith('/');
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
      return suggestions;
    } catch {
      return [];
    }
  }

  private async getFuzzyFileSuggestions(
    query: string,
    options: { readonly isQuotedPrefix: boolean; readonly signal: AbortSignal },
  ): Promise<AutocompleteItem[]> {
    if (this.fdPath === null || options.signal.aborted) return [];

    const scopedQuery = this.resolveScopedFuzzyQuery(query);
    const fdBaseDir = scopedQuery?.baseDir ?? this.basePath;
    const fdQuery = scopedQuery?.query ?? query;
    const entries = await walkDirectoryWithFd(fdBaseDir, this.fdPath, fdQuery, FD_MAX_RESULTS, options.signal);
    if (options.signal.aborted || entries.length === 0) return [];

    const scoredEntries = entries
      .map((entry) => ({ entry, score: scoreFdEntry(entry.path, fdQuery, entry.isDirectory) }))
      .filter(({ score }) => score > 0)
      .toSorted((a, b) => b.score - a.score)
      .slice(0, FUZZY_MAX_RESULTS);

    return scoredEntries.map(({ entry }) => {
      const pathWithoutSlash = entry.isDirectory ? entry.path.slice(0, -1) : entry.path;
      const displayPath =
        scopedQuery === null
          ? pathWithoutSlash
          : scopedPathForDisplay(scopedQuery.displayBase, pathWithoutSlash);
      const completionPath = entry.isDirectory ? `${displayPath}/` : displayPath;
      return {
        value: buildCompletionValue(completionPath, {
          isAtPrefix: true,
          isQuotedPrefix: options.isQuotedPrefix,
        }),
        label: `${basename(pathWithoutSlash)}${entry.isDirectory ? '/' : ''}`,
        description: displayPath,
      };
    });
  }

  private resolveScopedFuzzyQuery(rawQuery: string): {
    readonly baseDir: string;
    readonly query: string;
    readonly displayBase: string;
  } | null {
    const normalizedQuery = toDisplayPath(rawQuery);
    const slashIndex = normalizedQuery.lastIndexOf('/');
    if (slashIndex === -1) return null;

    const displayBase = normalizedQuery.slice(0, slashIndex + 1);
    const query = normalizedQuery.slice(slashIndex + 1);
    const baseDir = displayBase.startsWith('~/')
      ? expandHomePath(displayBase)
      : displayBase.startsWith('/')
        ? displayBase
        : join(this.basePath, displayBase);

    try {
      return statSync(baseDir).isDirectory() ? { baseDir, query, displayBase } : null;
    } catch {
      return null;
    }
  }
}

function toCommandSearchItem(item: AutocompleteItem | SlashCommand): {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
} {
  const name = commandNameFor(item);
  const hint = 'argumentHint' in item ? item.argumentHint : undefined;
  const description = item.description ?? '';
  const fullDescription = hint === undefined ? description : description ? `${hint} — ${description}` : hint;
  return {
    name,
    label: name,
    description: fullDescription || undefined,
  };
}

function commandNameFor(item: AutocompleteItem | SlashCommand): string {
  return 'name' in item ? item.name : item.value;
}

function extractAtPrefix(text: string): string | null {
  const quotedPrefix = extractQuotedPrefix(text);
  if (quotedPrefix?.startsWith('@"')) return quotedPrefix;

  const lastDelimiterIndex = findLastDelimiter(text);
  const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
  return text[tokenStart] === '@' ? text.slice(tokenStart) : null;
}

function extractPathPrefix(text: string, forceExtract: boolean): string | null {
  const quotedPrefix = extractQuotedPrefix(text);
  if (quotedPrefix !== null) return quotedPrefix;

  const lastDelimiterIndex = findLastDelimiter(text);
  const pathPrefix = lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1);
  if (forceExtract) return pathPrefix;
  if (pathPrefix.includes('/') || pathPrefix.startsWith('.') || pathPrefix.startsWith('~/')) return pathPrefix;
  // Returning an empty string here used to make the autocomplete list flash and
  // corrupt the TUI when a space was typed after a folder-like prefix. Falling
  // through to `null` keeps the list closed cleanly.
  return null;
}

function extractQuotedPrefix(text: string): string | null {
  const quoteStart = findUnclosedQuoteStart(text);
  if (quoteStart === null) return null;
  if (quoteStart > 0 && text[quoteStart - 1] === '@') {
    return isTokenStart(text, quoteStart - 1) ? text.slice(quoteStart - 1) : null;
  }
  return isTokenStart(text, quoteStart) ? text.slice(quoteStart) : null;
}

function parsePathPrefix(prefix: string): PathPrefix {
  if (prefix.startsWith('@"')) {
    return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
  }
  if (prefix.startsWith('"')) {
    return { rawPrefix: prefix.slice(1), isAtPrefix: false, isQuotedPrefix: true };
  }
  if (prefix.startsWith('@')) {
    return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
  }
  return { rawPrefix: prefix, isAtPrefix: false, isQuotedPrefix: false };
}

function findLastDelimiter(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (PATH_DELIMITERS.has(text[index] ?? '')) return index;
  }
  return -1;
}

function findUnclosedQuoteStart(text: string): number | null {
  let inQuotes = false;
  let quoteStart = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue;
    inQuotes = !inQuotes;
    if (inQuotes) quoteStart = index;
  }
  return inQuotes ? quoteStart : null;
}

function isTokenStart(text: string, index: number): boolean {
  return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? '');
}

function resolveSearchTarget(
  basePath: string,
  rawPrefix: string,
  expandedPrefix: string,
  isAtPrefix: boolean,
): { readonly searchDir: string; readonly searchPrefix: string } {
  const isRootPrefix =
    rawPrefix === '' ||
    rawPrefix === './' ||
    rawPrefix === '../' ||
    rawPrefix === '~' ||
    rawPrefix === '~/' ||
    rawPrefix === '/' ||
    (isAtPrefix && rawPrefix === '');

  if (isRootPrefix || rawPrefix.endsWith('/')) {
    return {
      searchDir: rawPrefix.startsWith('~') || expandedPrefix.startsWith('/')
        ? expandedPrefix
        : join(basePath, expandedPrefix),
      searchPrefix: '',
    };
  }

  const dir = dirname(expandedPrefix);
  return {
    searchDir: rawPrefix.startsWith('~') || expandedPrefix.startsWith('/') ? dir : join(basePath, dir),
    searchPrefix: basename(expandedPrefix),
  };
}

function pathForEntry(rawPrefix: string, expandedPrefix: string, name: string): string {
  if (rawPrefix.endsWith('/')) return toDisplayPath(`${rawPrefix}${name}`);
  if (rawPrefix.includes('/') || rawPrefix.includes('\\')) {
    if (rawPrefix.startsWith('~/')) {
      const homeRelativeDir = rawPrefix.slice(2);
      const dir = dirname(homeRelativeDir);
      return toDisplayPath(`~/${dir === '.' ? name : join(dir, name)}`);
    }
    if (rawPrefix.startsWith('/')) {
      const dir = dirname(rawPrefix);
      return toDisplayPath(dir === '/' ? `/${name}` : `${dir}/${name}`);
    }
    const relativePath = join(dirname(rawPrefix), name);
    return toDisplayPath(rawPrefix.startsWith('./') && !relativePath.startsWith('./') ? `./${relativePath}` : relativePath);
  }
  return toDisplayPath(expandedPrefix.startsWith('~') ? `~/${name}` : name);
}

function expandHomePath(path: string): string {
  if (path.startsWith('~/')) {
    const expanded = join(homedir(), path.slice(2));
    return path.endsWith('/') && !expanded.endsWith('/') ? `${expanded}/` : expanded;
  }
  if (path === '~') return homedir();
  return path;
}

function buildCompletionValue(
  path: string,
  options: { readonly isAtPrefix: boolean; readonly isQuotedPrefix: boolean },
): string {
  const prefix = options.isAtPrefix ? '@' : '';
  if (!options.isQuotedPrefix && !path.includes(' ')) return `${prefix}${path}`;
  return `${prefix}"${path}"`;
}

function replaceLine(
  lines: string[],
  cursorLine: number,
  nextLine: string,
  cursorCol: number,
): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number } {
  const nextLines = [...lines];
  nextLines[cursorLine] = nextLine;
  return { lines: nextLines, cursorLine, cursorCol };
}

function isSlashCommandNameCompletion(prefix: string, beforePrefix: string): boolean {
  return prefix.startsWith('/') && beforePrefix.trim() === '' && !prefix.slice(1).includes('/');
}

function completionCursorOffset(item: AutocompleteItem): number {
  return item.label.endsWith('/') && item.value.endsWith('"') ? item.value.length - 1 : item.value.length;
}

function toDisplayPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function scopedPathForDisplay(displayBase: string, relativePath: string): string {
  const normalizedRelativePath = toDisplayPath(relativePath);
  if (displayBase === '/') return `/${normalizedRelativePath}`;
  return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
}

function scoreFdEntry(path: string, query: string, isDirectory: boolean): number {
  if (query.length === 0) return 1;
  const lowerQuery = query.toLowerCase();
  const lowerPath = path.toLowerCase();
  const lowerName = basename(path).toLowerCase();
  let score = 0;
  if (lowerName === lowerQuery) score = 100;
  else if (lowerName.startsWith(lowerQuery)) score = 80;
  else if (lowerName.includes(lowerQuery)) score = 50;
  else if (lowerPath.includes(lowerQuery)) score = 30;
  return isDirectory && score > 0 ? score + 10 : score;
}

async function walkDirectoryWithFd(
  baseDir: string,
  fdPath: string,
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<FdEntry[]> {
  const args = [
    '--base-directory',
    baseDir,
    '--max-results',
    String(maxResults),
    '--type',
    'f',
    '--type',
    'd',
    '--follow',
    '--hidden',
    '--exclude',
    '.git',
    '--exclude',
    '.git/*',
    '--exclude',
    '.git/**',
  ];
  if (toDisplayPath(query).includes('/')) args.push('--full-path');
  if (query.length > 0) args.push(buildFdPathQuery(query));

  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve([]);
      return;
    }

    const child = spawn(fdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let resolved = false;
    const finish = (results: FdEntry[]): void => {
      if (resolved) return;
      resolved = true;
      signal.removeEventListener('abort', onAbort);
      resolve(results);
    };
    const onAbort = (): void => {
      if (child.exitCode === null) child.kill('SIGKILL');
    };

    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('error', () => {
      finish([]);
    });
    child.on('close', (code) => {
      if (signal.aborted || code !== 0 || stdout.length === 0) {
        finish([]);
        return;
      }

      finish(
        stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(toDisplayPath)
          .filter((line) => line !== '.git' && !line.startsWith('.git/') && !line.includes('/.git/'))
          .map((line) => {
            const isDirectory = line.endsWith('/');
            return { path: line, isDirectory };
          }),
      );
    });
  });
}

function buildFdPathQuery(query: string): string {
  const normalized = toDisplayPath(query);
  if (!normalized.includes('/')) return normalized;

  const hasTrailingSeparator = normalized.endsWith('/');
  const segments = normalized
    .replaceAll(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(escapeRegex);
  if (segments.length === 0) return normalized;

  const separatorPattern = '[\\\\/]';
  return `${segments.join(separatorPattern)}${hasTrailingSeparator ? separatorPattern : ''}`;
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
