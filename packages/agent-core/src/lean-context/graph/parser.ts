import { createRequire } from 'node:module';
import { dirname, join } from 'pathe';
import { Language, Parser, type Node } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

export type SupportedLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'unknown';

export interface ParsedTree {
  readonly language: SupportedLanguage;
  readonly rootType: string;
  readonly walk: (visitor: TreeVisitor) => void;
  readonly textForNode: (startIndex: number, endIndex: number) => string;
  readonly lineForIndex: (index: number) => number;
}

export interface TreeNodeView {
  readonly type: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly namedChildren: readonly TreeNodeView[];
  readonly childForField: (name: string) => TreeNodeView | undefined;
}

export type TreeVisitor = (node: TreeNodeView) => void;

let initPromise: Promise<void> | undefined;
const languageCache = new Map<SupportedLanguage, Language>();

const EXTENSION_LANGUAGE: Readonly<Record<string, SupportedLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

const WASM_PACKAGES: Readonly<Partial<Record<SupportedLanguage, { pkg: string; file: string }>>> = {
  typescript: { pkg: 'tree-sitter-typescript', file: 'tree-sitter-typescript.wasm' },
  tsx: { pkg: 'tree-sitter-typescript', file: 'tree-sitter-tsx.wasm' },
  javascript: { pkg: 'tree-sitter-javascript', file: 'tree-sitter-javascript.wasm' },
  python: { pkg: 'tree-sitter-python', file: 'tree-sitter-python.wasm' },
  go: { pkg: 'tree-sitter-go', file: 'tree-sitter-go.wasm' },
  rust: { pkg: 'tree-sitter-rust', file: 'tree-sitter-rust.wasm' },
};

export function detectLanguage(displayPath: string): SupportedLanguage {
  const lower = displayPath.toLowerCase();
  for (const [ext, language] of Object.entries(EXTENSION_LANGUAGE)) {
    if (lower.endsWith(ext)) return language;
  }
  return 'unknown';
}

export async function parseSource(displayPath: string, content: string): Promise<ParsedTree | undefined> {
  const language = detectLanguage(displayPath);
  if (language === 'unknown') return undefined;
  await ensureParserInitialized();
  const grammar = await loadLanguage(language);
  if (grammar === undefined) return undefined;
  const parser = new Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(content);
  if (tree === null) return undefined;
  const lineStarts = buildLineStarts(content);
  return {
    language,
    rootType: tree.rootNode.type,
    walk(visitor) {
      walkNode(tree.rootNode, content, visitor);
    },
    textForNode(startIndex, endIndex) {
      return content.slice(startIndex, endIndex);
    },
    lineForIndex(index) {
      return indexToLine(lineStarts, index);
    },
  };
}

async function ensureParserInitialized(): Promise<void> {
  if (initPromise === undefined) {
    initPromise = Parser.init();
  }
  await initPromise;
}

async function loadLanguage(language: SupportedLanguage): Promise<Language | undefined> {
  const cached = languageCache.get(language);
  if (cached !== undefined) return cached;
  const spec = WASM_PACKAGES[language];
  if (spec === undefined) return undefined;
  try {
    const pkgDir = dirname(require.resolve(`${spec.pkg}/package.json`));
    const wasmPath = join(pkgDir, spec.file);
    const loaded = await Language.load(wasmPath);
    languageCache.set(language, loaded);
    return loaded;
  } catch {
    return undefined;
  }
}

function walkNode(node: Node, content: string, visitor: TreeVisitor): void {
  // Visit every node with a *lazy* view. Materializing the full subtree for
  // each node (as the previous eager `toNodeView` did) made the walk
  // O(nodes x depth) and copied `content` slices for every node — on large
  // files this blocked the event loop long enough to defeat the index build
  // budget and stall subagents. The view now computes `text`/`namedChildren`/
  // `childForField` only when the visitor actually reads them, so an unread
  // node costs nothing beyond the shallow record.
  visitor(makeNodeView(node, content));
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child !== null) walkNode(child, content, visitor);
  }
}

function makeNodeView(node: Node, content: string): TreeNodeView {
  return {
    type: node.type,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    get text() {
      return content.slice(node.startIndex, node.endIndex);
    },
    get namedChildren() {
      const children: TreeNodeView[] = [];
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child !== null) children.push(makeNodeView(child, content));
      }
      return children;
    },
    childForField(name: string) {
      const child = node.childForFieldName(name);
      return child === null ? undefined : makeNodeView(child, content);
    },
  };
}

function buildLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function indexToLine(lineStarts: readonly number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    if (start === undefined) break;
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (index >= start && index < next) return mid + 1;
    if (index < start) high = mid - 1;
    else low = mid + 1;
  }
  return 1;
}
