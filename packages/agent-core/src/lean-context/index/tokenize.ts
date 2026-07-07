const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'is',
  'it',
  'this',
  'that',
  'with',
  'from',
  'as',
  'at',
  'by',
  'be',
  'are',
  'was',
  'were',
]);

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = normalized.match(/[a-z0-9_$.-]+/gu) ?? [];
  const result: string[] = [];
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    result.push(token);
  }
  return result;
}

export function termFrequency(tokens: readonly string[]): Record<string, number> {
  const tf: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const token of tokens) {
    tf[token] = (tf[token] ?? 0) + 1;
  }
  return tf;
}
