import { createHash } from 'node:crypto';

import type { Bm25ChunkRecord } from '../persist/types';

const SYMBOL_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*/u,
  /^(?:export\s+)?class\s+[A-Za-z_$][\w$]*/u,
  /^(?:export\s+)?interface\s+[A-Za-z_$][\w$]*/u,
  /^(?:export\s+)?type\s+[A-Za-z_$][\w$]*/u,
  /^(?:pub\s+)?(?:async\s+)?fn\s+[A-Za-z_][\w]*/u,
  /^def\s+[A-Za-z_][\w]*/u,
];

export function chunkFileContent(
  path: string,
  displayPath: string,
  content: string,
): readonly Bm25ChunkRecord[] {
  const lines = content.split(/\r?\n/);
  const chunks: Bm25ChunkRecord[] = [];
  let blockStart = 1;
  let blockLines: string[] = [];

  const flush = (endLine: number): void => {
    if (blockLines.length === 0) return;
    const text = blockLines.join('\n');
    chunks.push({
      id: hashChunk(displayPath, blockStart, endLine, text),
      path,
      displayPath,
      startLine: blockStart,
      endLine,
      text,
      length: text.length,
    });
    blockLines = [];
  };

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    const isBoundary =
      line.trim().length === 0 ||
      SYMBOL_PATTERNS.some((pattern) => pattern.test(line.trim())) ||
      blockLines.length >= 40;
    if (isBoundary && blockLines.length > 0) {
      flush(lineNo - 1);
      blockStart = lineNo;
    }
    blockLines.push(line);
    if (blockLines.length >= 40) {
      flush(lineNo);
      blockStart = lineNo + 1;
      blockLines = [];
    }
  }
  if (blockLines.length > 0) flush(lines.length);
  if (chunks.length === 0 && content.length > 0) {
    chunks.push({
      id: hashChunk(displayPath, 1, lines.length, content),
      path,
      displayPath,
      startLine: 1,
      endLine: lines.length,
      text: content.slice(0, 4000),
      length: Math.min(content.length, 4000),
    });
  }
  return chunks;
}

function hashChunk(displayPath: string, start: number, end: number, text: string): string {
  return createHash('sha256').update(`${displayPath}:${start}-${end}:${text}`).digest('hex').slice(0, 16);
}

export function extractImportEdges(
  displayPath: string,
  content: string,
): ReadonlyArray<{ readonly from: string; readonly to: string; readonly line: number }> {
  const edges: Array<{ from: string; to: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const match =
      /^(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|(?:const|let|var)\s+[\w${}\s,]+\s*=\s*require\()\["']([^"']+)["']/.exec(
        trimmed,
      );
    if (match?.[1] !== undefined) {
      edges.push({ from: displayPath, to: match[1], line: index + 1 });
    }
  }
  return edges;
}
