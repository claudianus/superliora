/**
 * Mechanical craft audit for VerifySurface — banned-ship heuristics on
 * snapshot / visualDescription text. Vision models can refine later; this
 * never fake-passes when clear placeholder signals are present.
 */

export interface CraftAuditInput {
  readonly snapshot?: string | undefined;
  readonly visualDescription?: string | undefined;
  readonly title?: string | undefined;
}

export interface CraftAuditResult {
  readonly pass: boolean;
  readonly hits: readonly string[];
  readonly notes: readonly string[];
}

const BANNED_PATTERNS: readonly { readonly id: string; readonly re: RegExp }[] = [
  { id: 'lorem_ipsum', re: /\blorem\s+ipsum\b/i },
  { id: 'placeholder_copy', re: /\b(todo|tbd|placeholder|coming soon)\b/i },
  { id: 'dead_hash_link', re: /\bhref=["']#["']/i },
  { id: 'purple_ai_gradient', re: /\b(purple|violet|indigo)\b.*\b(gradient|neon)\b/i },
  { id: 'emoji_as_ui', re: /(?:^|\s)(?:🚀|✨|🔥|💡|🎯){2,}/u },
];

export function auditSurfaceCraft(input: CraftAuditInput): CraftAuditResult {
  const corpus = [input.title, input.snapshot, input.visualDescription]
    .filter((part): part is string => part !== undefined && part.trim().length > 0)
    .join('\n');
  if (corpus.trim().length === 0) {
    return {
      pass: false,
      hits: ['empty_surface_text'],
      notes: ['Craft audit: no snapshot/description to score — craft=failed (fail-closed).'],
    };
  }
  const hits = BANNED_PATTERNS.filter((rule) => rule.re.test(corpus)).map((rule) => rule.id);
  if (hits.length > 0) {
    return {
      pass: false,
      hits,
      notes: [`Craft audit failed banned ship states: ${hits.join(', ')}`],
    };
  }
  return {
    pass: true,
    hits: [],
    notes: ['Craft audit: no banned ship-state markers in surface text.'],
  };
}
