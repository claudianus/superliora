import type { SymbolEntry } from './context-types';

export type LioraReadMode = 'auto' | 'full' | 'signatures' | 'map' | 'lines';

export interface TerseReadInput {
  readonly content: string;
  readonly displayPath: string;
  readonly mode: LioraReadMode;
  readonly startLine?: number | undefined;
  readonly limit?: number | undefined;
  readonly maxChars?: number | undefined;
}

export interface TerseReadResult {
  readonly text: string;
  readonly lineCount: number;
  readonly renderedLines: number;
  readonly modeUsed: LioraReadMode;
  readonly overflow: string | undefined;
}

/** Full-file read budget: no practical clip; callers may still pass a bound. */
const DEFAULT_MAX_CHARS = Number.MAX_SAFE_INTEGER;
/** Prefer signatures only for very large files; smaller files stay full text. */
const AUTO_FULL_LINE_THRESHOLD = 2_000;

export function renderTerseRead(input: TerseReadInput): TerseReadResult {
  const lines = input.content.split(/\r?\n/);
  const mode = resolveMode(input.mode, lines.length);
  if (mode === 'lines') {
    return renderLineWindow(lines, input);
  }
  if (mode === 'signatures' || mode === 'map') {
    return renderSymbolView(lines, input.displayPath, mode, input.maxChars ?? DEFAULT_MAX_CHARS);
  }
  return renderFullView(lines, input.displayPath, mode, input.maxChars ?? DEFAULT_MAX_CHARS);
}

function resolveMode(mode: LioraReadMode, lineCount: number): LioraReadMode {
  if (mode !== 'auto') return mode;
  return lineCount <= AUTO_FULL_LINE_THRESHOLD ? 'full' : 'signatures';
}

function renderLineWindow(lines: readonly string[], input: TerseReadInput): TerseReadResult {
  const start = Math.max(1, input.startLine ?? 1);
  const limit = Math.max(1, input.limit ?? 80);
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const selected = lines.slice(start - 1, start - 1 + limit);
  const rendered: string[] = [
    `<liora_read mode="lines" path="${input.displayPath}">`,
    `window: ${String(start)}-${String(start + selected.length - 1)} of ${String(lines.length)}`,
  ];
  let chars = rendered.join('\n').length;
  for (const [index, line] of selected.entries()) {
    const row = `${String(start + index)}\t${line}`;
    if (chars + row.length + 1 > maxChars) break;
    rendered.push(row);
    chars += row.length + 1;
  }
  rendered.push('</liora_read>');
  const text = rendered.join('\n');
  const overflow =
    text.length < input.content.length ? input.content.slice(text.length) : undefined;
  return {
    text,
    lineCount: lines.length,
    renderedLines: selected.length,
    modeUsed: 'lines',
    overflow,
  };
}

function renderSymbolView(
  lines: readonly string[],
  displayPath: string,
  mode: 'signatures' | 'map',
  maxChars: number,
): TerseReadResult {
  const content = lines.join('\n');
  const symbols = extractSymbolsFromContent(content);
  const rendered: string[] = [
    `<liora_read mode="${mode}" path="${displayPath}">`,
    `lines: ${String(lines.length)}`,
    'symbols:',
  ];
  for (const symbol of symbols) {
    rendered.push(`- L${String(symbol.line)} ${symbol.kind} ${symbol.name}: ${symbol.signature}`);
  }
  if (mode === 'map') {
    rendered.push('structure: imports/exports only — use mode=full or LioraRead mode=lines for bodies.');
  }
  rendered.push('</liora_read>');
  let text = rendered.join('\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 20) + '\n[...truncated]';
  }
  return {
    text,
    lineCount: lines.length,
    renderedLines: symbols.length,
    modeUsed: mode,
    overflow: content,
  };
}

function renderFullView(
  lines: readonly string[],
  displayPath: string,
  modeUsed: LioraReadMode,
  maxChars: number,
): TerseReadResult {
  const rendered: string[] = [`<liora_read mode="full" path="${displayPath}">`];
  let chars = rendered[0]?.length ?? 0;
  let renderedLines = 0;
  for (const [index, line] of lines.entries()) {
    const row = `${String(index + 1)}\t${line}`;
    if (chars + row.length + 1 > maxChars) break;
    rendered.push(row);
    chars += row.length + 1;
    renderedLines += 1;
  }
  const truncated = renderedLines < lines.length;
  if (truncated) rendered.push('[...truncated — use LioraExpand or LioraRead mode=lines]');
  rendered.push('</liora_read>');
  const text = rendered.join('\n');
  return {
    text,
    lineCount: lines.length,
    renderedLines,
    modeUsed,
    overflow: truncated ? lines.slice(renderedLines).join('\n') : undefined,
  };
}

function extractSymbolsFromContent(content: string): SymbolEntry[] {
  return content
    .split(/\r?\n/)
    .flatMap((line, index) => extractSymbols(line, index + 1))
    .filter((symbol): symbol is SymbolEntry => symbol !== undefined);
}

function extractSymbols(line: string, lineNumber: number): SymbolEntry | undefined {
  const trimmed = line.trim();
  const patterns: ReadonlyArray<readonly [RegExp, string, number]> = [
    [/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/, 'class', 1],
    [/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, 'interface', 1],
    [/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/, 'type', 1],
    [/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
  ];
  for (const [pattern, kind, group] of patterns) {
    const match = pattern.exec(trimmed);
    if (match !== null) {
      return {
        line: lineNumber,
        kind,
        name: match[group] ?? '(anonymous)',
        signature: trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed,
      };
    }
  }
  return undefined;
}
