import type { ContextFile, RankedFile } from './context-types';

interface RenderContextInput {
  readonly query?: string | undefined;
  readonly mode?: 'pack' | 'search' | 'map' | 'compose' | undefined;
}

export function renderContextPacket(
  ranked: readonly RankedFile[],
  input: RenderContextInput,
  allFiles: readonly ContextFile[],
): string {
  const mode = input.mode ?? 'pack';
  const rawChars = ranked.reduce((sum, item) => sum + item.file.content.length, 0);
  const body = buildPacketBody(ranked, input, allFiles, mode);
  const stats = computeStats(body, rawChars);
  body.splice(5, 0, `raw_chars_indexed: ${rawChars}`);
  body.splice(6, 0, `packet_chars: ${stats.packetChars}`);
  body.splice(7, 0, `estimated_saved_percent: ${stats.estimatedSavedPercent}`);
  body.push('</kimi_context_packet>');
  return body.join('\n');
}

function buildPacketBody(
  ranked: readonly RankedFile[],
  input: RenderContextInput,
  allFiles: readonly ContextFile[],
  mode: 'pack' | 'search' | 'map' | 'compose',
): string[] {
  const body: string[] = [
    `<kimi_context_packet version="1" mode="${mode}">`,
    'strategy: lean-codegraph',
    'knowledge_map: compact-project-map',
    'relationship_confidence: EXTRACTED | INFERRED | AMBIGUOUS',
    'path_affected_questions: files -> symbols -> tests -> tools -> UX surfaces',
    `query: ${input.query ?? '(paths only)'}`,
    `files_considered: ${allFiles.length}`,
    `files_returned: ${ranked.length}`,
  ];
  for (const item of ranked) {
    body.push('');
    body.push(`file: ${item.file.displayPath}`);
    body.push(`lines: ${item.file.lineCount}`);
    appendSymbols(body, item, mode);
    appendRelationships(body, item);
    appendTestHints(body, item);
    appendMatches(body, item, mode);
    if (mode === 'compose') appendInlineEvidence(body, item);
    body.push('expand: use LioraRead(mode=lines|full) or Read for exact edit bytes.');
  }
  return body;
}

function appendSymbols(
  body: string[],
  item: RankedFile,
  mode: 'pack' | 'search' | 'map' | 'compose',
): void {
  if (mode === 'search') return;
  body.push('symbols:');
  if (item.symbols.length === 0) {
    body.push('- (none detected)');
    return;
  }
  for (const symbol of item.symbols) {
    body.push(`- L${symbol.line} ${symbol.kind} ${symbol.name}: ${symbol.signature}`);
  }
}

function appendMatches(
  body: string[],
  item: RankedFile,
  mode: 'pack' | 'search' | 'map' | 'compose',
): void {
  if (mode === 'map') return;
  body.push('matches:');
  if (item.matches.length === 0) {
    body.push('- (none)');
    return;
  }
  for (const match of item.matches) {
    body.push(`- L${match.line} ${match.text}`);
  }
}

function appendRelationships(body: string[], item: RankedFile): void {
  body.push('relationships:');
  if (item.relationships.length === 0) {
    body.push('- (none detected)');
    return;
  }
  for (const relationship of item.relationships.slice(0, 8)) {
    body.push(
      `- L${relationship.line} ${relationship.kind} ${relationship.target} [${relationship.confidence}]: ${relationship.text}`,
    );
  }
}

function appendTestHints(body: string[], item: RankedFile): void {
  body.push('test_hints:');
  if (item.testHints.length === 0) {
    body.push('- (none inferred)');
    return;
  }
  for (const hint of item.testHints.slice(0, 3)) {
    body.push(`- ${hint.confidence} ${hint.path}: ${hint.reason}`);
  }
}

function appendInlineEvidence(body: string[], item: RankedFile): void {
  body.push('inline_evidence:');
  const lines = item.file.content.split(/\r?\n/);
  const wantedLines = new Set<number>();
  for (const match of item.matches) wantedLines.add(match.line);
  for (const symbol of item.symbols.slice(0, 4)) wantedLines.add(symbol.line);
  const selected = [...wantedLines].toSorted((a, b) => a - b).slice(0, 8);
  if (selected.length === 0) {
    body.push('- (none)');
    return;
  }
  for (const lineNo of selected) {
    const line = lines[lineNo - 1];
    if (line === undefined) continue;
    body.push(`- L${String(lineNo)} ${truncate(line.trim(), 180)}`);
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function computeStats(body: readonly string[], rawChars: number): {
  readonly packetChars: number;
  readonly estimatedSavedPercent: number;
} {
  const packetChars = [...body, '</kimi_context_packet>'].join('\n').length;
  const estimatedSavedPercent =
    rawChars === 0 ? 0 : Math.max(0, Math.round((1 - packetChars / rawChars) * 100));
  return { packetChars, estimatedSavedPercent };
}
