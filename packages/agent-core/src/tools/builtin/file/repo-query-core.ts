import { z } from 'zod';

export const REPO_QUERY_MODES = ['symbol', 'content', 'path', 'outline'] as const;
export type RepoQueryMode = (typeof REPO_QUERY_MODES)[number];

export const RepoQueryInputSchema = z.object({
  mode: z.enum(REPO_QUERY_MODES).describe('Search mode: symbol, content, path, or outline.'),
  query: z.string().min(1).describe('Search pattern, symbol name, glob, or outline filter.'),
  path: z
    .string()
    .optional()
    .describe('Optional file or directory scope. Required for outline when query is not a file path.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum results to return. Defaults to 20.'),
  context_lines: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Context lines around content matches. Applies only when mode=content.'),
});

export type RepoQueryInput = z.infer<typeof RepoQueryInputSchema>;

export const DEFAULT_REPO_QUERY_LIMIT = 20;

export type RepoQueryIndexStatus = 'cold' | 'warm' | 'partial';

export interface RepoQueryResultEnvelope {
  readonly mode: RepoQueryMode;
  readonly results: readonly string[];
  readonly index_status: RepoQueryIndexStatus;
  readonly took_ms: number;
  readonly truncated: boolean;
  readonly hint?: string | undefined;
  readonly next_step?: string | undefined;
}

export function normalizeRepoQueryLimit(limit: number | undefined): number {
  return limit ?? DEFAULT_REPO_QUERY_LIMIT;
}

export function parseRepoQueryInput(
  raw: unknown,
): { ok: true; value: RepoQueryInput } | { ok: false; message: string } {
  const parsed = RepoQueryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
    };
  }
  const validation = validateRepoQueryModeInput(parsed.data);
  if (!validation.ok) return validation;
  return { ok: true, value: parsed.data };
}

export function validateRepoQueryModeInput(
  input: RepoQueryInput,
): { ok: true } | { ok: false; message: string } {
  if (input.mode === 'outline' && input.path === undefined && !looksLikeFilePath(input.query)) {
    return {
      ok: false,
      message: 'outline mode requires path to a file (or a query that looks like a file path).',
    };
  }
  return { ok: true };
}

function looksLikeFilePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || /\.[a-z0-9]{1,8}$/iu.test(value);
}

export function formatRepoQueryOutput(envelope: RepoQueryResultEnvelope): string {
  const lines = [
    `<repo_query mode="${escapeAttribute(envelope.mode)}">`,
    `index_status: ${envelope.index_status}`,
    `took_ms: ${String(envelope.took_ms)}`,
    `truncated: ${String(envelope.truncated)}`,
    `results: ${String(envelope.results.length)}`,
    ...envelope.results.map((line) => `- ${line}`),
  ];
  if (envelope.hint !== undefined && envelope.hint.length > 0) {
    lines.push(`hint: ${envelope.hint}`);
  }
  if (envelope.next_step !== undefined && envelope.next_step.length > 0) {
    lines.push(`next_step: ${envelope.next_step}`);
  }
  lines.push('</repo_query>');
  return lines.join('\n');
}

export function softFailRepoQuery(
  mode: RepoQueryMode,
  hint: string,
  nextStep: string,
  tookMs = 0,
): string {
  return formatRepoQueryOutput({
    mode,
    results: [],
    index_status: 'cold',
    took_ms: tookMs,
    truncated: false,
    hint,
    next_step: nextStep,
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
