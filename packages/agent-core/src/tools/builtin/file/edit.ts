/**
 * EditTool — exact string replacement in a file.
 *
 * Replaces the first occurrence of `old_string` with `new_string` by
 * default. When `replace_all` is true, replaces all occurrences.
 * Errors when `old_string` is not found or not unique (when
 * `replace_all=false`). Path access policy is resolved before any
 * Kaos I/O.
 */

import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { FileSnapshotStore } from '../../../session/file-snapshot';
import { checkSwarmFileLease } from '#/fleet';
import {
  policyForSandboxProfile,
  resolvePathAccessPath,
} from '../../policies/path-access';
import {
  FABRICATED_DEFER_BLOCKED_MESSAGE,
  hasFabricatedDeferral,
} from '../../support/fabricated-defer';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import { materializeModelText, toModelTextView } from './line-endings';
import EDIT_DESCRIPTION from './edit.md?raw';

// `old_string` must be non-empty: the non-replace_all branch walks
// occurrences with `content.indexOf("", pos)`, which would loop forever
// on an empty search string.
export const EditInputSchema = z.object({
  path: z
    .string()
    .describe(
      'Path to the text file to edit. Relative paths resolve against the working directory; a path outside the working directory must be absolute.',
    ),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Exact content to replace from the Read output view, without the line-number prefix. Use LF for pure CRLF files; use actual \\r escapes where Read shows \\r.',
    ),
  new_string: z
    .string()
    .describe(
      'Replacement text in the same Read output view. LF is written back as CRLF only for pure CRLF files.',
    ),
  replace_all: z
    .boolean()
    .optional()
    .describe('Set true only when every occurrence of old_string should be replaced.'),
});

export type EditInput = z.Infer<typeof EditInputSchema>;

function replaceOnceLiteral(content: string, oldString: string, newString: string): string {
  const index = content.indexOf(oldString);
  if (index === -1) return content;
  return content.slice(0, index) + newString + content.slice(index + oldString.length);
}

// --- not-found diagnostics --------------------------------------------------
// `old_string not found` is the most common Edit failure for LLM consumers.
// These helpers append cheap hints to that error: the file's mtime (stale
// Read detector) and up to three near-miss snippets from the current content.
// Candidate search is one O(lines) anchor prefilter plus a bounded number of
// small window comparisons — never O(n^2) over the whole file.

const CANDIDATE_MAX_FILE_LINES = 20000;
const CANDIDATE_MAX_ANCHORS = 24;
const CANDIDATE_MAX_RESULTS = 3;
const CANDIDATE_MIN_SCORE = 0.35;
const CANDIDATE_SNIPPET_LINE_MAX = 200;
const LEVENSHTEIN_CELL_BUDGET = 4_000_000;
const TOKEN_PATTERN = /[\p{L}\p{N}_$]+/gu;

function countLines(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.codePointAt(i) === 10) lines++;
  }
  return lines;
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    tokens.add(match[0]);
  }
  return tokens;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  let short = a;
  let long = b;
  if (short.length > long.length) [short, long] = [long, short];
  if (short.length === 0) return 0;
  let prev = Array.from({ length: short.length + 1 }, (_, idx) => idx);
  let curr = Array.from({ length: short.length + 1 }, () => 0);
  for (let j = 1; j <= long.length; j++) {
    curr[0] = j;
    const code = long.codePointAt(j - 1);
    for (let i = 1; i <= short.length; i++) {
      const cost = short.codePointAt(i - 1) === code ? 0 : 1;
      curr[i] = Math.min((prev[i] ?? 0) + 1, (curr[i - 1] ?? 0) + 1, (prev[i - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return 1 - (prev[short.length] ?? 0) / long.length;
}

/** Normalized similarity in [0, 1]; falls back to token overlap on big texts. */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length * b.length > LEVENSHTEIN_CELL_BUDGET) {
    return jaccard(tokenize(a), tokenize(b));
  }
  return levenshteinRatio(a, b);
}

/**
 * Renders up to three near-miss snippets from `fileText` for a missing
 * `oldText`, or '' when nothing plausible exists (huge file, no token
 * overlap, every score below threshold). Line numbers are 1-based original
 * file lines: CRLF-to-LF normalization preserves line indices.
 */
function similarCandidateBlock(fileText: string, oldText: string): string {
  if (oldText.length === 0) return '';
  if (countLines(fileText) > CANDIDATE_MAX_FILE_LINES) return '';
  const oldLines = oldText.split('\n');
  const firstTokens = tokenize(oldLines[0] ?? '');
  const lastTokens = tokenize(oldLines.at(-1) ?? '');
  if (firstTokens.size === 0 && lastTokens.size === 0) return '';

  const fileLines = fileText.split('\n');
  const anchors: number[] = [];
  for (let i = 0; i < fileLines.length && anchors.length < CANDIDATE_MAX_ANCHORS; i++) {
    const tokens = tokenize(fileLines[i] ?? '');
    if (tokens.size === 0) continue;
    if (jaccard(tokens, firstTokens) >= 0.5 || jaccard(tokens, lastTokens) >= 0.5) {
      anchors.push(i);
    }
  }
  if (anchors.length === 0) return '';

  const windowLength = Math.min(oldLines.length + 2, fileLines.length);
  const maxStart = Math.max(0, fileLines.length - windowLength);
  const seenStarts = new Set<number>();
  const scored: Array<{ start: number; score: number }> = [];
  for (const anchor of anchors) {
    // The anchor may have matched old_string's first or last line, so try
    // both alignments; each keeps +/-1 line of surrounding context.
    for (const rawStart of [anchor - 1, anchor - oldLines.length]) {
      const start = Math.min(Math.max(rawStart, 0), maxStart);
      if (seenStarts.has(start)) continue;
      seenStarts.add(start);
      const windowText = fileLines.slice(start, start + windowLength).join('\n');
      const score = textSimilarity(windowText, oldText);
      if (score >= CANDIDATE_MIN_SCORE) scored.push({ start, score });
    }
  }
  if (scored.length === 0) return '';

  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, CANDIDATE_MAX_RESULTS)
    .map(({ start }) => {
      const snippet = fileLines
        .slice(start, start + windowLength)
        .map((line) => {
          const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
          const clipped =
            clean.length > CANDIDATE_SNIPPET_LINE_MAX
              ? `${clean.slice(0, CANDIDATE_SNIPPET_LINE_MAX)}...`
              : clean;
          return `    ${clipped}`;
        })
        .join('\n');
      return `candidate near line ${String(start + 1)}:\n${snippet}\n`;
    })
    .join('\n');
}

/** Files modified within this window are treated as session-time changes. */
const STALE_VIEW_WINDOW_MS = 10 * 60_000;

async function notFoundDetail(
  kaos: Kaos,
  safePath: string,
  shownPath: string,
  fileText: string,
  oldText: string,
): Promise<string> {
  let detail = `old_string not found in ${shownPath}, the file contents may be out of date. Please use the Read Tool to reload the content.\n`;
  try {
    const st = await kaos.stat(safePath);
    if (Number.isFinite(st.stMtime) && st.stMtime > 0) {
      // Stale-replay detection (harness reform T1-2): a very recent mtime
      // means the file changed during this session, so the model's
      // in-context view almost certainly predates the change. Call it out
      // instead of letting the caller retry old_string from memory.
      const ageMs = Date.now() - st.stMtime * 1000;
      if (ageMs >= 0 && ageMs < STALE_VIEW_WINDOW_MS) {
        detail += `STALE VIEW: the file was modified ${String(Math.max(1, Math.round(ageMs / 1000)))}s ago — your in-context Read output predates that change, which is why old_string does not match. Re-Read ${shownPath} and rebuild old_string from fresh bytes; do not retry from memory.\n`;
      }
      detail += `file last modified: ${new Date(st.stMtime * 1000).toISOString()} — if your last Read predates this, re-read the file first.\n`;
    }
  } catch {
    // stat unavailable (e.g. test fake without override); omit the hint.
  }
  detail += similarCandidateBlock(fileText, oldText);
  detail += formatEditRemediationFooter(shownPath);
  return detail;
}

/** ACI-style recovery lines shared by not-found / not-unique Edit failures. */
export function formatEditRemediationFooter(shownPath: string): string {
  return [
    '',
    'Remediation:',
    `- Re-Read \`${shownPath}\` (exact bytes) and rebuild old_string from that output — do not retry from memory.`,
    '- Prefer absolute paths for path (workspace-relative is ok when unambiguous).',
    '- For a single edit: add more unique surrounding context to old_string.',
    '- For every occurrence: set replace_all=true.',
    '- Multi-hunk / multi-file: prefer ApplyPatch over repeated Edit.',
    '',
  ].join('\n');
}

export class EditTool implements BuiltinTool<EditInput> {
  readonly name = 'Edit' as const;
  readonly description = EDIT_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(EditInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly options?: {
      readonly fileSnapshots?: FileSnapshotStore | undefined;
      readonly turnId?: string | undefined;
      /** Resolved at execution time so the active turn id is current. */
      readonly getTurnId?: (() => string | undefined) | undefined;
      /**
       * Optional file-lease identity. When owner/run are present,
       * claims the path before mutation; conflicts return an error tool result.
       * When absent, Edit behaves as before (no-op lease).
       */
      readonly getSwarmLease?:
        | (() => { readonly ownerId?: string; readonly runId?: string } | undefined)
        | undefined;
      /** Optional post-mutation hook (e.g. plugin LSP diagnostics). */
      readonly onFileMutated?:
        | ((path: string, content: string) => Promise<string | undefined> | string | undefined)
        | undefined;
    },
  ) {}

  resolveExecution(args: EditInput): ToolExecution {
    const path = resolvePathAccessPath(args.path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
      policy:
        this.workspace.sandboxProfile !== undefined
          ? policyForSandboxProfile(this.workspace.sandboxProfile)
          : undefined,
    });
    return {
      accesses: ToolAccesses.readWriteFile(path),
      description: `Editing ${args.path}`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path,
        before: args.old_string,
        after: args.new_string,
      },
      approvalRule: literalRulePattern(this.name, path),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, path, {
          cwd: this.workspace.workspaceDir,
          pathClass: this.kaos.pathClass(),
          homeDir: this.kaos.gethome(),
        }),
      execute: () => this.execution(args, path),
    };
  }

  private async execution(args: EditInput, safePath: string): Promise<ExecutableToolResult> {
    if (args.old_string === args.new_string) {
      return {
        isError: true,
        output: 'No changes to make: old_string and new_string are exactly the same.',
      };
    }

    if (hasFabricatedDeferral(args.new_string)) {
      return { isError: true, output: FABRICATED_DEFER_BLOCKED_MESSAGE };
    }

    const lease = this.options?.getSwarmLease?.();
    const leaseError = checkSwarmFileLease(safePath, lease?.ownerId, lease?.runId);
    if (leaseError !== undefined) {
      return { isError: true, output: leaseError };
    }

    const snapshots = this.options?.fileSnapshots;
    const turnId = this.options?.getTurnId?.() ?? this.options?.turnId;
    if (snapshots !== undefined && turnId !== undefined) {
      await snapshots.captureBeforeWrite(turnId, safePath);
    }

    try {
      const raw = await this.kaos.readText(safePath);
      const modelView = toModelTextView(raw);
      const content = modelView.text;
      const replaceAll = args.replace_all ?? false;

      if (!replaceAll) {
        let count = 0;
        let pos = 0;
        while (pos < content.length) {
          const idx = content.indexOf(args.old_string, pos);
          if (idx === -1) break;
          count++;
          pos = idx + args.old_string.length;
        }

        if (count === 0) {
          return {
            isError: true,
            output: await notFoundDetail(this.kaos, safePath, args.path, content, args.old_string),
          };
        }
        if (count > 1) {
          return {
            isError: true,
            output:
              `old_string is not unique in ${args.path} (found ${String(count)} occurrences). ` +
              'To replace every occurrence, set replace_all=true. To replace only one occurrence, include more surrounding context in old_string.' +
              formatEditRemediationFooter(args.path),
          };
        }

        const newContent = replaceOnceLiteral(content, args.old_string, args.new_string);
        const written = materializeModelText(newContent, modelView.lineEndingStyle);
        await this.kaos.writeAtomic(safePath, written);
        return {
          output: await this.withMutationDiagnostics(
            safePath,
            written,
            `Replaced 1 occurrence in ${args.path}`,
          ),
        };
      }

      const parts = content.split(args.old_string);
      const replacementCount = parts.length - 1;
      if (replacementCount === 0) {
        return {
          isError: true,
          output: await notFoundDetail(this.kaos, safePath, args.path, content, args.old_string),
        };
      }

      const newContent = parts.join(args.new_string);
      const written = materializeModelText(newContent, modelView.lineEndingStyle);
      await this.kaos.writeAtomic(safePath, written);
      return {
        output: await this.withMutationDiagnostics(
          safePath,
          written,
          `Replaced ${String(replacementCount)} occurrences in ${args.path}`,
        ),
      };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'EISDIR') {
        return { isError: true, output: `${args.path} is not a file.` };
      }
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withMutationDiagnostics(
    path: string,
    content: string,
    output: string,
  ): Promise<string> {
    const extra = await this.options?.onFileMutated?.(path, content);
    if (extra === undefined || extra.trim() === '') return output;
    return `${output}\n\n${extra.trim()}`;
  }
}
