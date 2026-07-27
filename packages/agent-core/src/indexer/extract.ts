// Code indexer — symbol extraction (T5-1).
// Parses a source file with oxc and extracts top-level declarations as compact
// symbol records. Pure and synchronous; no I/O, no AST retention (extract -> return -> discard).
import { parseSync } from 'oxc-parser';

export type IndexedSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable';

export interface IndexedSymbol {
  readonly name: string;
  readonly kind: IndexedSymbolKind;
  /** 1-based line of the declaration start. */
  readonly line: number;
  readonly exported: boolean;
  readonly defaultExport: boolean;
}

export interface ExtractResult {
  readonly symbols: readonly IndexedSymbol[];
  readonly parseErrorCount: number;
}

// Minimal structural view over the oxc AST nodes we consume. Keeps agent-core
// decoupled from the generated @oxc-project/types surface.
interface AstIdentifier {
  readonly type: string;
  readonly name?: string;
}
interface AstVariableDeclarator {
  readonly id: AstIdentifier;
  readonly start: number;
}
interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly id?: AstIdentifier | null;
  readonly kind?: string;
  readonly declaration?: AstNode | null;
  readonly declarations?: readonly AstVariableDeclarator[];
}
interface AstProgram {
  readonly body?: readonly AstNode[];
}

export function langForFile(fileName: string): 'ts' | 'tsx' | 'dts' | 'js' | 'jsx' {
  if (fileName.endsWith('.d.ts')) return 'dts';
  if (fileName.endsWith('.tsx')) return 'tsx';
  if (fileName.endsWith('.ts') || fileName.endsWith('.mts') || fileName.endsWith('.cts')) return 'ts';
  if (fileName.endsWith('.jsx') || fileName.endsWith('.mjsx')) return 'jsx';
  return 'js';
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineOf(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const DECLARATION_KINDS: Record<string, IndexedSymbolKind> = {
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class',
  TSInterfaceDeclaration: 'interface',
  TSTypeAliasDeclaration: 'type',
  TSEnumDeclaration: 'enum',
};

export function extractSymbols(fileName: string, source: string): ExtractResult {
  const parsed = parseSync(fileName, source, { lang: langForFile(fileName) });
  const lineStarts = buildLineStarts(source);
  const symbols: IndexedSymbol[] = [];

  const collect = (node: AstNode | null | undefined, exported: boolean, defaultExport: boolean): void => {
    if (!node) return;
    const kind = DECLARATION_KINDS[node.type];
    if (kind !== undefined) {
      const name = node.id?.name;
      if (name) {
        symbols.push({ name, kind, line: lineOf(lineStarts, node.start), exported, defaultExport });
      }
      return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations ?? []) {
        if (declarator.id.type === 'Identifier' && declarator.id.name) {
          symbols.push({
            name: declarator.id.name,
            kind: 'variable',
            line: lineOf(lineStarts, declarator.start),
            exported,
            defaultExport,
          });
        }
      }
    }
  };

  const program = parsed.program as unknown as AstProgram;
  for (const node of program.body ?? []) {
    if (node.type === 'ExportNamedDeclaration') {
      collect(node.declaration, true, false);
    } else if (node.type === 'ExportDefaultDeclaration') {
      collect(node.declaration, true, true);
    } else {
      collect(node, false, false);
    }
  }

  return { symbols, parseErrorCount: parsed.errors.length };
}
