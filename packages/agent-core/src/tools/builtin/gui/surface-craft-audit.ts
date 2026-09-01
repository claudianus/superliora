/**
 * Mechanical craft audit for VerifySurface — banned-ship heuristics on
 * snapshot / visualDescription text. Attribute notation carried by
 * accessibility snapshots (`href=…`, `placeholder=…`, `class=…`, `data-*`)
 * is source metadata, not visible copy, so it is stripped before matching:
 * SPA `href="#"` anchors and form `placeholder` attributes are functional
 * UI, not banned ship states. Product copy keeps matching ("Todo" app copy
 * passes; a literal `TODO:` marker fails). Vision models can refine later;
 * this never fake-passes when clear placeholder signals are present.
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

const ATTRIBUTE_NOISE_PATTERN =
  /\b(?:href|src|class|placeholder|data-[a-z-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s\]]+)/gi;

const BANNED_PATTERNS: readonly { readonly id: string; readonly re: RegExp }[] = [
  { id: 'lorem_ipsum', re: /\blorem\s+ipsum\b/i },
  { id: 'placeholder_copy', re: /\bplaceholder\b|\btbd\b|\bcoming\s+soon\b/i },
  { id: 'todo_marker', re: /\btodo\s*[:：]/i },
  { id: 'purple_ai_gradient', re: /\b(purple|violet|indigo)\b.*\b(gradient|neon)\b/i },
  { id: 'emoji_as_ui', re: /(?:^|\s)(?:🚀|✨|🔥|💡|🎯){2,}/u },
];

function stripAttributeNoise(text: string): string {
  return text.replace(ATTRIBUTE_NOISE_PATTERN, ' ');
}

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
  const hits = BANNED_PATTERNS.filter((rule) =>
    rule.re.test(stripAttributeNoise(corpus)),
  ).map((rule) => rule.id);
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
