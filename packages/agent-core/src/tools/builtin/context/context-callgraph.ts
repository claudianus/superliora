import type { ContextFile } from './context-types';

export interface CallgraphNode {
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
}

export interface CallgraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'call' | 'import';
  readonly file: string;
  readonly line: number;
}

export interface CallgraphResult {
  readonly symbol: string;
  readonly definitions: readonly CallgraphNode[];
  readonly references: readonly CallgraphEdge[];
  readonly imports: readonly CallgraphEdge[];
}

export function buildCallgraph(
  files: readonly ContextFile[],
  symbol: string,
  direction: 'callers' | 'callees' | 'both',
): CallgraphResult {
  const normalized = symbol.trim();
  const definitions: CallgraphNode[] = [];
  const references: CallgraphEdge[] = [];
  const imports: CallgraphEdge[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (isDefinition(trimmed, normalized)) {
        definitions.push({ symbol: normalized, file: file.displayPath, line: lineNumber });
      }
      const importEdge = extractImport(trimmed, file.displayPath, lineNumber);
      if (importEdge !== undefined) imports.push(importEdge);
      if (direction === 'callers' || direction === 'both') {
        const caller = extractReference(trimmed, normalized, file.displayPath, lineNumber, 'call');
        if (caller !== undefined) references.push(caller);
      }
      if (direction === 'callees' || direction === 'both') {
        for (const callee of extractCallees(trimmed, file.displayPath, lineNumber)) {
          if (normalized.length === 0 || callee.from.includes(normalized)) references.push(callee);
        }
      }
    }
  }

  return {
    symbol: normalized,
    definitions: definitions.slice(0, 20),
    references: references.slice(0, 40),
    imports: imports.slice(0, 40),
  };
}

function isDefinition(line: string, symbol: string): boolean {
  const escaped = escapeRegExp(symbol);
  return new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var)\\s+${escaped}\\b`,
    'u',
  ).test(line);
}

function extractImport(
  line: string,
  file: string,
  lineNumber: number,
): CallgraphEdge | undefined {
  const match =
    /^(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|(?:const|let|var)\s+[\w${}\s,]+\s*=\s*require\()\["']([^"']+)["']/.exec(
      line,
    );
  if (match === null) return undefined;
  return {
    from: file,
    to: match[1] ?? '(unknown)',
    kind: 'import',
    file,
    line: lineNumber,
  };
}

function extractReference(
  line: string,
  symbol: string,
  file: string,
  lineNumber: number,
  kind: 'call',
): CallgraphEdge | undefined {
  if (isDefinition(line, symbol)) return undefined;
  const escaped = escapeRegExp(symbol);
  if (!new RegExp(`\\b${escaped}\\b`, 'u').test(line)) return undefined;
  return { from: file, to: symbol, kind, file, line: lineNumber };
}

function extractCallees(line: string, file: string, lineNumber: number): CallgraphEdge[] {
  const edges: CallgraphEdge[] = [];
  const callPattern = /\b([A-Za-z_$][\w$]*)\s*\(/gu;
  for (const match of line.matchAll(callPattern)) {
    const callee = match[1];
    if (callee === undefined || callee === 'if' || callee === 'for' || callee === 'while') continue;
    edges.push({ from: file, to: callee, kind: 'call', file, line: lineNumber });
  }
  return edges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function renderCallgraph(result: CallgraphResult): string {
  const lines: string[] = [
    `<liora_callgraph symbol="${result.symbol}">`,
    `definitions: ${String(result.definitions.length)}`,
  ];
  for (const def of result.definitions) {
    lines.push(`- ${def.file}:L${String(def.line)} defines ${def.symbol}`);
  }
  lines.push(`references: ${String(result.references.length)}`);
  for (const ref of result.references.slice(0, 20)) {
    lines.push(`- ${ref.file}:L${String(ref.line)} ${ref.kind} -> ${ref.to}`);
  }
  if (result.references.length > 20) {
    lines.push(`- ... ${String(result.references.length - 20)} more references`);
  }
  lines.push(`imports: ${String(result.imports.length)}`);
  for (const edge of result.imports.slice(0, 12)) {
    lines.push(`- ${edge.file}:L${String(edge.line)} import -> ${edge.to}`);
  }
  lines.push('</liora_callgraph>');
  return lines.join('\n');
}
