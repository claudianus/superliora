import { parseStructuredCompactionMemory } from '../compaction/memory';

import { TOKEN_STOPWORDS } from './constants';
import type { ContextOSPage } from './types';

export function extractFileHintsFromText(text: string): readonly string[] {
  const matches = text.matchAll(
    /`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))`|([A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))/gi,
  );
  const files: string[] = [];
  for (const match of matches) {
    files.push((match[1] ?? match[2] ?? '').trim());
  }
  return files;
}

export function uniqueSortedStrings(items: readonly string[]): readonly string[] {
  return [...new Set(items.filter((item) => item.length > 0))].toSorted();
}

export function filesMatch(pageFile: string, queryFile: string): boolean {
  if (pageFile === queryFile) return true;
  if (pageFile.endsWith(`/${queryFile}`) || queryFile.endsWith(`/${pageFile}`)) return true;
  const pageBasename = pageFile.split('/').at(-1);
  const queryBasename = queryFile.split('/').at(-1);
  return pageBasename !== undefined && pageBasename === queryBasename;
}

export function fileMentionedByQuery(file: string, queryLower: string): boolean {
  const normalized = file.toLowerCase();
  if (queryLower.includes(normalized)) return true;
  const basename = normalized.split('/').at(-1);
  return basename !== undefined && basename.length >= 3 && queryLower.includes(basename);
}

export function tokenize(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3 && !TOKEN_STOPWORDS.has(part)),
  );
}

export function compactedNarrativeText(summary: string): string {
  const marker = '\n## Compacted Narrative\n';
  const markerIndex = summary.indexOf(marker);
  const narrative = markerIndex === -1 ? summary : summary.slice(markerIndex + marker.length);
  const memoryIndex = narrative.search(/\n## Working Memory \(Key Facts\)/);
  return memoryIndex === -1 ? narrative : narrative.slice(0, memoryIndex);
}

export function extractFocusFileHints(summary: string): readonly string[] {
  const narrative = compactedNarrativeText(summary);
  return uniqueSortedStrings(extractFileHintsFromText(narrative));
}

export function selectionFileHints(page: ContextOSPage): readonly string[] {
  const focusFileHints = extractFocusFileHints(page.summary);
  return focusFileHints.length > 0 ? focusFileHints : page.contextPack.contextOS.fileHints;
}

export function pageSearchText(page: ContextOSPage): string {
  const contextOS = page.contextPack.contextOS;
  const focusText = structuredSignalText(page);
  return [
    focusText.length > 0
      ? focusText
      : contextOS.retrievalQueries.filter((hint) => !hint.startsWith('file:')).join(' '),
    ...contextOS.continuity.reasons,
    page.contextPack.evidence.actionTypes.join(' '),
    page.contextPack.evidence.rawRefKinds.join(' '),
  ].join(' ');
}

export function structuredSignalText(page: ContextOSPage): string {
  const focusedMemory = parseStructuredCompactionMemory(compactedNarrativeText(page.summary));
  const focusedText = structuredMemorySearchText(focusedMemory, selectionFileHints(page));
  if (focusedText.length > 0) return focusedText;
  return structuredMemorySearchText(parseStructuredCompactionMemory(page.summary), selectionFileHints(page));
}

function structuredMemorySearchText(
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
  fileHints: readonly string[],
): string {
  return [
    memory.currentGoal,
    ...memory.lastKnownState,
    ...memory.decisions,
    ...memory.filesTouched,
    ...memory.failedAttempts,
    ...memory.openQuestions,
    ...memory.nextActions,
    ...fileHints,
  ]
    .filter((item): item is string => item !== undefined && item.length > 0)
    .join(' ');
}

export function pageMatchesQueryFiles(
  page: ContextOSPage,
  queryFileHints: readonly string[],
): boolean {
  if (queryFileHints.length === 0) return true;
  const pageFileHints = selectionFileHints(page).map((file) => file.toLowerCase());
  return queryFileHints.some((queryFile) =>
    pageFileHints.some((pageFile) => filesMatch(pageFile, queryFile.toLowerCase())),
  );
}
