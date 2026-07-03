import type {
  ContextFile,
  MatchEntry,
  RankedFile,
  RelationshipEntry,
  SymbolEntry,
  TestHintEntry,
} from './context-types';

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_SYMBOLS = 12;
const MAX_MATCHES_PER_FILE = 4;
const MAX_SNIPPET_LENGTH = 160;

interface RankContextInput {
  readonly query?: string | undefined;
  readonly paths?: readonly string[] | undefined;
  readonly max_files?: number | undefined;
  readonly max_symbols_per_file?: number | undefined;
}

export function rankContextFiles(
  files: readonly ContextFile[],
  input: RankContextInput,
): RankedFile[] {
  const query = input.query?.toLowerCase();
  const normalizedQuery = query === undefined ? undefined : normalizeToken(query);
  const maxFiles = input.max_files ?? DEFAULT_MAX_FILES;
  const maxSymbols = input.max_symbols_per_file ?? DEFAULT_MAX_SYMBOLS;
  return files
    .map((file) => {
      const symbols = extractSymbols(file.content).slice(0, maxSymbols);
      const matches = query === undefined ? [] : findMatches(file.content, query);
      return {
        file,
        symbols,
        matches,
        relationships: extractRelationships(file.content),
        testHints: buildTestHints(file.displayPath),
        score: scoreFile(file, symbols, matches, query, normalizedQuery),
      };
    })
    .filter((ranked) => input.paths !== undefined || ranked.score > 0)
    .toSorted((a, b) => b.score - a.score || a.file.displayPath.localeCompare(b.file.displayPath))
    .slice(0, maxFiles);
}

function scoreFile(
  file: ContextFile,
  symbols: readonly SymbolEntry[],
  matches: readonly MatchEntry[],
  query: string | undefined,
  normalizedQuery: string | undefined,
): number {
  if (query === undefined) return 1;
  let score = matches.length * 10;
  const normalizedPath = normalizeToken(file.displayPath);
  if (normalizedQuery !== undefined && normalizedQuery.length > 0 && normalizedPath.includes(normalizedQuery)) {
    score += 20;
  }
  if (file.displayPath.toLowerCase().includes(query)) score += 8;
  for (const symbol of symbols) {
    const normalizedName = normalizeToken(symbol.name);
    if (normalizedQuery !== undefined && normalizedQuery.length > 0 && normalizedName.includes(normalizedQuery)) {
      score += 16;
    }
    if (symbol.name.toLowerCase().includes(query)) score += 12;
    if (symbol.signature.toLowerCase().includes(query)) score += 5;
  }
  return score === 0 ? 0 : score + sourcePathBoost(file.displayPath);
}

function sourcePathBoost(displayPath: string): number {
  if (/^(?:packages|apps)\/[^/]+\/src\//.test(displayPath)) return 8;
  if (displayPath.startsWith('src/')) return 6;
  if (/^(?:packages|apps)\//.test(displayPath)) return 3;
  return 0;
}

function extractSymbols(content: string): SymbolEntry[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => extractSymbol(line, index + 1))
    .filter((symbol): symbol is SymbolEntry => symbol !== undefined);
}

function extractSymbol(line: string, lineNumber: number): SymbolEntry | undefined {
  const trimmed = line.trim();
  const patterns: ReadonlyArray<readonly [RegExp, string, number]> = [
    [/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/, 'class', 1],
    [/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, 'interface', 1],
    [/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/, 'type', 1],
    [/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function', 1],
    [/^def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^class\s+([A-Za-z_][\w]*)\b/, 'class', 1],
    [/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][\w]*)\b/, 'type', 1],
    [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
  ];
  for (const [pattern, kind, group] of patterns) {
    const match = pattern.exec(trimmed);
    if (match !== null) {
      return {
        line: lineNumber,
        kind,
        name: match[group] ?? '(anonymous)',
        signature: truncate(trimmed, MAX_SNIPPET_LENGTH),
      };
    }
  }
  return undefined;
}

function findMatches(content: string, query: string): MatchEntry[] {
  const matches: MatchEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.toLowerCase().includes(query)) continue;
    matches.push({ line: index + 1, text: truncate(line.trim(), MAX_SNIPPET_LENGTH) });
    if (matches.length >= MAX_MATCHES_PER_FILE) break;
  }
  return matches;
}

function extractRelationships(content: string): RelationshipEntry[] {
  const relationships: RelationshipEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const relationship = extractRelationship(line, index + 1);
    if (relationship !== undefined) relationships.push(relationship);
    if (relationships.length >= 12) break;
  }
  return relationships;
}

function extractRelationship(line: string, lineNumber: number): RelationshipEntry | undefined {
  const trimmed = line.trim();
  const importMatch =
    /^(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|import\s*\(|(?:const|let|var)\s+[\w${}\s,]+\s*=\s*require\()["']([^"']+)["']/.exec(trimmed);
  if (importMatch !== null) {
    return {
      line: lineNumber,
      kind: 'import',
      target: importMatch[1] ?? '(unknown)',
      confidence: 'EXTRACTED',
      text: truncate(trimmed, MAX_SNIPPET_LENGTH),
    };
  }
  const reExportMatch = /^export\s+(?:type\s+)?(?:\*|\{[^}]+\})\s+from\s+["']([^"']+)["']/.exec(trimmed);
  if (reExportMatch !== null) {
    return {
      line: lineNumber,
      kind: 'export',
      target: reExportMatch[1] ?? '(unknown)',
      confidence: 'EXTRACTED',
      text: truncate(trimmed, MAX_SNIPPET_LENGTH),
    };
  }
  const exportDeclMatch =
    /^export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
  if (exportDeclMatch !== null) {
    return {
      line: lineNumber,
      kind: 'export',
      target: exportDeclMatch[1] ?? '(unknown)',
      confidence: 'EXTRACTED',
      text: truncate(trimmed, MAX_SNIPPET_LENGTH),
    };
  }
  const namedExportMatch = /^export\s+\{([^}]+)\}/.exec(trimmed);
  if (namedExportMatch !== null) {
    return {
      line: lineNumber,
      kind: 'export',
      target: truncate(namedExportMatch[1]?.trim() ?? '(unknown)', 80),
      confidence: 'EXTRACTED',
      text: truncate(trimmed, MAX_SNIPPET_LENGTH),
    };
  }
  return undefined;
}

function buildTestHints(displayPath: string): TestHintEntry[] {
  if (/\.(?:test|spec)\.[tj]sx?$/iu.test(displayPath) || /(?:^|\/)__tests__\//u.test(displayPath)) {
    return [{ confidence: 'EXTRACTED', path: displayPath, reason: 'current file is already a test file' }];
  }
  const extensionMatch = /\.(?:[cm]?[tj]sx?|vue|svelte)$/iu.exec(displayPath);
  if (extensionMatch === null) return [];
  const extension = extensionMatch[0];
  const base = displayPath.slice(0, -extension.length);
  const fileName = base.split('/').at(-1) ?? base;
  return [
    {
      confidence: 'INFERRED',
      path: `${base}.test${extension}`,
      reason: 'same-directory focused test candidate',
    },
    {
      confidence: 'INFERRED',
      path: `test/${base.replace(/^(?:packages|apps)\/[^/]+\//u, '')}.test${extension}`,
      reason: 'workspace test tree candidate',
    },
    {
      confidence: 'INFERRED',
      path: `test/**/${fileName}.test${extension}`,
      reason: 'nearest existing test with matching module name',
    },
  ];
}

function normalizeToken(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]+/g, '');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
