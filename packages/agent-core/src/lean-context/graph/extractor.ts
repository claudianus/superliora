import { createHash } from 'node:crypto';

import type { ParsedTree, SupportedLanguage, TreeNodeView } from './parser';
import { detectLanguage } from './parser';
import type { GraphEdgeRecord, GraphNodeKind, GraphNodeRecord } from './types';

interface ExtractInput {
  readonly path: string;
  readonly displayPath: string;
  readonly content: string;
  readonly tree: ParsedTree | undefined;
}

interface MutableNode extends GraphNodeRecord {
  readonly childIds: string[];
}

const DEFINITION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'method_definition',
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'lexical_declaration',
  'variable_declaration',
  'function_item',
  'function_definition',
  'class_definition',
]);

export function extractFileGraph(input: ExtractInput): {
  readonly nodes: GraphNodeRecord[];
  readonly edges: GraphEdgeRecord[];
} {
  if (input.tree !== undefined) {
    return extractFromTree(input);
  }
  return extractFromRegex(input.displayPath, input.content);
}

function extractFromTree(input: ExtractInput): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] } {
  const language = input.tree?.language ?? detectLanguage(input.displayPath);
  const nodes: MutableNode[] = [
    {
      id: makeNodeId(input.displayPath, '__module__', 1),
      type: 'module',
      name: '__module__',
      qualifiedName: '__module__',
      filePath: input.displayPath,
      startLine: 1,
      endLine: 1,
      language,
      signature: '',
      body: '',
      isTest: isTestFile(input.displayPath),
      childIds: [],
    },
  ];
  const edges: GraphEdgeRecord[] = [];
  const stack: MutableNode[] = [];

  input.tree?.walk((node) => {
    const definition = definitionFromNode(node, language, input.displayPath, input.content);
    if (definition !== undefined) {
      while (stack.length > 0) {
        const top = stack.at(-1);
        if (top === undefined || top.endLine < definition.startLine) break;
        stack.pop();
      }
      const parent = stack.at(-1);
      const qualifiedName =
        parent === undefined ? definition.name : `${parent.qualifiedName}.${definition.name}`;
      const record: MutableNode = {
        ...definition,
        qualifiedName,
        filePath: input.displayPath,
        language,
        childIds: [],
      };
      if (parent !== undefined) parent.childIds.push(record.id);
      nodes.push(record);
      stack.push(record);
      return;
    }

    const importEdge = importFromNode(node, input.displayPath, nodes);
    if (importEdge !== undefined) {
      edges.push(importEdge);
      return;
    }

    if (node.type === 'call_expression') {
      const callEdge = callFromNode(node, input.displayPath, nodes, stack);
      if (callEdge !== undefined) edges.push(callEdge);
    }
  });

  return { nodes, edges };
}

function definitionFromNode(
  node: TreeNodeView,
  language: SupportedLanguage,
  displayPath: string,
  content: string,
): Omit<GraphNodeRecord, 'qualifiedName' | 'filePath' | 'language'> | undefined {
  if (!DEFINITION_TYPES.has(node.type)) return undefined;
  const nameNode =
    node.childForField('name') ??
    node.childForField('declarator')?.childForField('name') ??
    node.namedChildren.find((child) => child.type === 'identifier' || child.type === 'property_identifier');
  const name = nameNode?.text ?? fallbackName(node, content);
  if (name.length === 0) return undefined;
  const kind = nodeKind(node.type);
  const signature = firstLine(node.text);
  const body = node.text.slice(0, 4_000);
  return {
    id: makeNodeId(displayPath, name, node.startLine),
    type: kind,
    name,
    startLine: node.startLine,
    endLine: node.endLine,
    signature,
    body,
    isTest: isTestFile(displayPath) || name.toLowerCase().includes('test'),
  };
}

function importFromNode(
  node: TreeNodeView,
  displayPath: string,
  nodes: readonly GraphNodeRecord[],
): GraphEdgeRecord | undefined {
  if (node.type !== 'import_statement' && node.type !== 'import_declaration') return undefined;
  const sourceNode = node.childForField('source');
  const specifier = sourceNode?.text.replace(/^['"]|['"]$/gu, '') ?? '';
  if (specifier.length === 0) return undefined;
  const owner = enclosingNode(nodes, node.startLine);
  return {
    sourceId: owner?.id ?? makeNodeId(displayPath, '__module__', 1),
    targetSpecifier: specifier,
    type: 'import',
    line: node.startLine,
  };
}

function callFromNode(
  node: TreeNodeView,
  displayPath: string,
  nodes: readonly GraphNodeRecord[],
  stack: readonly MutableNode[],
): GraphEdgeRecord | undefined {
  const fn = node.childForField('function') ?? node.namedChildren[0];
  if (fn === undefined) return undefined;
  const callee = calleeName(fn);
  if (callee.length === 0) return undefined;
  const owner = stack.at(-1) ?? enclosingNode(nodes, node.startLine);
  const target = nodes.find((item) => item.name === callee || item.qualifiedName.endsWith(`.${callee}`));
  return {
    sourceId: owner?.id ?? makeNodeId(displayPath, '__module__', 1),
    targetId: target?.id,
    targetSpecifier: callee,
    type: 'call',
    line: node.startLine,
  };
}

function extractFromRegex(displayPath: string, content: string): {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
} {
  const language = detectLanguage(displayPath);
  const nodes: GraphNodeRecord[] = [
    {
      id: makeNodeId(displayPath, '__module__', 1),
      type: 'module',
      name: '__module__',
      qualifiedName: '__module__',
      filePath: displayPath,
      startLine: 1,
      endLine: 1,
      language,
      signature: '',
      body: '',
      isTest: isTestFile(displayPath),
    },
  ];
  const edges: GraphEdgeRecord[] = [];
  const lines = content.split(/\r?\n/);
  const patterns: Array<{ re: RegExp; kind: GraphNodeKind }> = [
    { re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u, kind: 'function' },
    { re: /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/u, kind: 'class' },
    { re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/u, kind: 'interface' },
    { re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/u, kind: 'type' },
    { re: /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/u, kind: 'enum' },
    { re: /^def\s+([A-Za-z_][\w]*)/u, kind: 'function' },
    { re: /^(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/u, kind: 'function' },
  ];
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    const trimmed = line.trim();
    for (const pattern of patterns) {
      const match = pattern.re.exec(trimmed);
      if (match?.[1] === undefined) continue;
      const name = match[1];
      nodes.push({
        id: makeNodeId(displayPath, name, lineNo),
        type: pattern.kind,
        name,
        qualifiedName: name,
        filePath: displayPath,
        startLine: lineNo,
        endLine: lineNo,
        language,
        signature: trimmed.slice(0, 180),
        body: trimmed,
        isTest: isTestFile(displayPath),
      });
      break;
    }
    const importMatch =
      /^(?:import\s+[\s\S]*?\s+from\s+|(?:const|let|var)\s+[\w$,\s{}]+\s*=\s*require\()['"]([^'"]+)['"]/u.exec(
        trimmed,
      );
    if (importMatch?.[1] !== undefined) {
      edges.push({
        sourceId: makeNodeId(displayPath, '__module__', 1),
        targetSpecifier: importMatch[1],
        type: 'import',
        line: lineNo,
      });
    }
  }
  return { nodes, edges };
}

function nodeKind(type: string): GraphNodeKind {
  if (type.includes('class')) return 'class';
  if (type.includes('interface')) return 'interface';
  if (type.includes('enum')) return 'enum';
  if (type.includes('method')) return 'method';
  if (type.includes('type')) return 'type';
  if (type.includes('function') || type.includes('function_item') || type.includes('function_definition')) {
    return 'function';
  }
  return 'variable';
}

function fallbackName(node: TreeNodeView, content: string): string {
  const line = content.split(/\r?\n/)[node.startLine - 1]?.trim() ?? '';
  const match = /(?:function|class|interface|type|enum|def|fn)\s+([A-Za-z_$][\w$]*)/u.exec(line);
  return match?.[1] ?? '';
}

function calleeName(node: TreeNodeView): string {
  if (node.type === 'identifier' || node.type === 'property_identifier') return node.text;
  if (node.type === 'member_expression') {
    const property = node.childForField('property');
    return property?.text ?? '';
  }
  return '';
}

function enclosingNode(nodes: readonly GraphNodeRecord[], line: number): GraphNodeRecord | undefined {
  return nodes.find((node) => node.startLine <= line && line <= node.endLine);
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim().slice(0, 180) ?? '';
}

function isTestFile(displayPath: string): boolean {
  return /\.(test|spec)\.[a-z]+$/iu.test(displayPath) || displayPath.includes('/test/');
}

export function makeNodeId(displayPath: string, name: string, line: number): string {
  return createHash('sha1').update(`${displayPath}:${name}:${String(line)}`).digest('hex').slice(0, 16);
}
