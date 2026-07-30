import type {
  ContextOSPage,
  ContextOSSelection,
  ContextOSSelectionResult,
  ContextOSSupersessionResult,
} from './types';
import {
  extractFileHintsFromText,
  fileMentionedByQuery,
  pageMatchesQueryFiles,
  pageSearchText,
  selectionFileHints,
  structuredSignalText,
  tokenize,
} from './file-hints';

export function selectPagesWithMetadata(
  pages: readonly ContextOSPage[],
  query: string,
  limit: number,
): ContextOSSelectionResult {
  if (pages.length === 0) {
    return {
      selections: [],
      supersededCount: 0,
      queryFileHintCount: extractFileHintsFromText(query).length,
      candidatePageCount: 0,
      metadataFilteredPageCount: 0,
      semanticFilteredPageCount: 0,
    };
  }
  const queryFileHints = extractFileHintsFromText(query);
  const metadataCandidatePages = pages.filter((page) => pageMatchesQueryFiles(page, queryFileHints));
  const candidatePages =
    queryFileHints.length === 0
      ? filterByDistinctiveQueryTerms(metadataCandidatePages, query)
      : metadataCandidatePages;
  const scored = candidatePages
    .map((page) => {
      const pageIndex = pages.findIndex((candidate) => candidate.id === page.id);
      return scorePage(page, query, pageIndex >= 0 ? pageIndex : 0, pages.length);
    })
    .filter((selection) => selection.score > 0);
  const fresh = suppressSupersededSelections(scored, query);
  const ranked = fresh.selections.toSorted(
    (a, b) => b.score - a.score || b.page.sequence - a.page.sequence,
  );
  return {
    selections: ranked.slice(0, limit),
    supersededCount: fresh.supersededCount,
    queryFileHintCount: queryFileHints.length,
    candidatePageCount: candidatePages.length,
    metadataFilteredPageCount: pages.length - metadataCandidatePages.length,
    semanticFilteredPageCount: metadataCandidatePages.length - candidatePages.length,
  };
}

function filterByDistinctiveQueryTerms(
  pages: readonly ContextOSPage[],
  query: string,
): readonly ContextOSPage[] {
  if (pages.length <= 1) return pages;
  const queryTerms = [...tokenize(query)];
  if (queryTerms.length === 0) return pages;

  const pageTerms = pages.map((page) => tokenize(pageSearchText(page)));
  const matchingTerms = queryTerms
    .map((term) => ({
      term,
      matchCount: pageTerms.filter((terms) => terms.has(term)).length,
    }))
    .filter(({ matchCount }) => matchCount > 0);
  if (matchingTerms.length === 0) return pages;

  const rarestMatchCount = Math.min(...matchingTerms.map(({ matchCount }) => matchCount));
  if (rarestMatchCount >= pages.length) return pages;
  const rarestTerms = matchingTerms
    .filter(({ matchCount }) => matchCount === rarestMatchCount)
    .map(({ term }) => term);
  const scored = pages.map((page, index) => {
    const terms = pageTerms[index];
    return {
      page,
      rarestOverlap: rarestTerms.filter((term) => terms?.has(term)).length,
    };
  });
  const bestOverlap = Math.max(...scored.map(({ rarestOverlap }) => rarestOverlap));
  if (bestOverlap === 0) return pages;
  return scored
    .filter(({ rarestOverlap }) => rarestOverlap === bestOverlap)
    .map(({ page }) => page);
}

function scorePage(
  page: ContextOSPage,
  query: string,
  index: number,
  totalPages: number,
): ContextOSSelection {
  const contextOS = page.contextPack.contextOS;
  const fileHints = selectionFileHints(page);
  const queryTerms = [...tokenize(query)];
  const haystackTerms = tokenize(pageSearchText(page));
  const structuredTerms = tokenize(structuredSignalText(page));
  const overlap = queryTerms.filter((term) => haystackTerms.has(term)).length;
  const structuredOverlap = queryTerms.filter((term) => structuredTerms.has(term)).length;
  const queryLower = query.toLowerCase();
  const fileMentioned = fileHints.some((file) => fileMentionedByQuery(file, queryLower));
  const distanceFromNewest = Math.max(0, totalPages - index - 1);
  const recency = totalPages <= 1 ? 1 : 0.5 ** (distanceFromNewest / 4);
  const qualityScore = contextOS.qualitySignals?.recallEvalScore ?? 0.75;
  const evidenceScore = contextOS.qualitySignals?.evidenceIdRecallScore ?? 1;

  // Evidence fidelity is a first-class continuity signal for harness resume (T4).
  let score =
    recency * 0.11 +
    contextOS.continuity.score * 0.08 +
    qualityScore * 0.07 +
    evidenceScore * 0.08;
  const reasons: string[] = [];

  if (overlap > 0) {
    score += Math.min(0.25, overlap * 0.06);
    reasons.push('query_overlap');
  }
  if (structuredOverlap > 0) {
    score += Math.min(0.25, structuredOverlap * 0.09);
    reasons.push('structured_memory_match');
  }
  if (fileMentioned) {
    score += 0.4;
    reasons.push('file_hint_match');
  }
  if (contextOS.continuity.status !== 'ready') {
    score += 0.05;
    reasons.push(contextOS.continuity.status);
  }
  if (evidenceScore < 1) {
    score -= Math.min(0.12, (1 - evidenceScore) * 0.12);
    reasons.push('missing_evidence_ids');
  } else if (contextOS.qualitySignals?.evidenceIdRecallScore !== undefined) {
    reasons.push('evidence_ids_preserved');
  }
  if (
    !reasons.includes('query_overlap') &&
    !reasons.includes('structured_memory_match') &&
    !reasons.includes('file_hint_match')
  ) {
    score = 0;
  } else {
    reasons.unshift('recent_context_page');
  }

  return {
    page,
    score: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
    reasons,
  };
}

function suppressSupersededSelections(
  selections: readonly ContextOSSelection[],
  query: string,
): ContextOSSupersessionResult {
  const keyed = selections.map((selection) => ({
    selection,
    keys: supersessionKeys(selection.page, query),
  }));
  const suppressedIndexes = new Set<number>();

  for (let index = 0; index < keyed.length; index += 1) {
    const current = keyed[index];
    if (current === undefined || current.keys.length === 0) continue;
    for (const other of keyed) {
      if (other.selection.page.sequence <= current.selection.page.sequence) continue;
      if (!setsOverlap(current.keys, other.keys)) continue;
      suppressedIndexes.add(index);
      break;
    }
  }

  return {
    selections: keyed
      .filter((_entry, index) => !suppressedIndexes.has(index))
      .map((entry) => entry.selection),
    supersededCount: suppressedIndexes.size,
  };
}

function supersessionKeys(page: ContextOSPage, query: string): readonly string[] {
  const queryLower = query.toLowerCase();
  const keys = selectionFileHints(page)
    .filter((file) => fileMentionedByQuery(file, queryLower))
    .map((file) => `file:${file.toLowerCase()}`);
  return [...new Set(keys)];
}

function setsOverlap(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}
