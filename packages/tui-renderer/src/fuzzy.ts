export interface FuzzyMatch {
  readonly matches: boolean;
  readonly score: number;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const primary = fuzzyMatchSingleToken(queryLower, textLower);
  if (primary.matches) return primary;

  const alphaNumericMatch = /^(?<letters>[a-z]+)(?<digits>[0-9]+)$/.exec(queryLower);
  const numericAlphaMatch = /^(?<digits>[0-9]+)(?<letters>[a-z]+)$/.exec(queryLower);
  const swappedQuery = alphaNumericMatch
    ? `${alphaNumericMatch.groups?.['digits'] ?? ''}${alphaNumericMatch.groups?.['letters'] ?? ''}`
    : numericAlphaMatch
      ? `${numericAlphaMatch.groups?.['letters'] ?? ''}${numericAlphaMatch.groups?.['digits'] ?? ''}`
      : '';
  if (swappedQuery.length === 0) return primary;

  const swapped = fuzzyMatchSingleToken(swappedQuery, textLower);
  return swapped.matches ? { matches: true, score: swapped.score + 5 } : primary;
}

export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;

  const results: Array<{ readonly item: T; readonly score: number }> = [];
  for (const item of items) {
    let score = 0;
    let matches = true;
    const text = getText(item);
    for (const token of tokens) {
      const match = fuzzyMatch(token, text);
      if (!match.matches) {
        matches = false;
        break;
      }
      score += match.score;
    }
    if (matches) results.push({ item, score });
  }

  results.sort((a, b) => a.score - b.score);
  return results.map((result) => result.item);
}

function fuzzyMatchSingleToken(query: string, text: string): FuzzyMatch {
  if (query.length === 0) return { matches: true, score: 0 };
  if (query.length > text.length) return { matches: false, score: 0 };

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  let consecutiveMatches = 0;

  for (let index = 0; index < text.length && queryIndex < query.length; index++) {
    if (text[index] !== query[queryIndex]) continue;

    const previous = text[index - 1];
    const isWordBoundary = index === 0 || previous === undefined || /[\s\-_.:/]/.test(previous);
    if (lastMatchIndex === index - 1) {
      consecutiveMatches++;
      score -= consecutiveMatches * 5;
    } else {
      consecutiveMatches = 0;
      if (lastMatchIndex >= 0) score += (index - lastMatchIndex - 1) * 2;
    }
    if (isWordBoundary) score -= 10;
    score += index * 0.1;
    lastMatchIndex = index;
    queryIndex++;
  }

  if (queryIndex < query.length) return { matches: false, score: 0 };
  if (query === text) score -= 100;
  return { matches: true, score };
}
