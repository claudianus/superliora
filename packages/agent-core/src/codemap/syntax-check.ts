// Post-edit syntax check.
//
// A malformed edit is the one failure that compounds: the file stops parsing,
// so every later build, typecheck and test run fails too, and the model burns
// turns rediscovering the same first error. Reporting it inside the tool
// result that caused it costs a few tokens and saves those turns.
//
// This is a parse check, not a type check. oxc parses a typical source file
// in tens of microseconds and needs no project graph, which is what makes it
// affordable to run on every mutation; type errors are the plugin LSP's job.
//
// Returns `undefined` — the common case — when the file is not source, parses
// cleanly, or the native binding is unavailable. Nothing is reported for a
// clean file: a "0 problems" line would spend tokens on every single edit.

import { parseSourceErrors, type OxcParseError } from '#/codemap/oxc';

/** Enough to act on without flooding the context; the rest are implied. */
const MAX_REPORTED = 8;

interface SyntaxDiagnostic {
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  readonly message: string;
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.codePointAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineOf(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function toDiagnostic(
  error: OxcParseError,
  lineStarts: readonly number[],
  lineWidth: number,
): SyntaxDiagnostic {
  const offset = error.labels?.[0]?.start ?? 0;
  const line = lineOf(lineStarts, offset);
  const lineStart = lineStarts[line - 1] ?? 0;
  return {
    line,
    column: Math.max(1, offset - lineStart + 1),
    message: error.message.replaceAll(/\s+/g, ' ').trim().slice(0, lineWidth),
  };
}

interface SyntaxReport {
  readonly diagnostics: readonly SyntaxDiagnostic[];
  /** Errors oxc reported, including any dropped by {@link MAX_REPORTED}. */
  readonly totalCount: number;
}

/**
 * Parse errors for `source`, or `undefined` when there is nothing to report.
 */
export function collectSyntaxReport(
  fileName: string,
  source: string,
): SyntaxReport | undefined {
  let errors: readonly OxcParseError[] | undefined;
  try {
    errors = parseSourceErrors(fileName, source);
  } catch {
    // No native binding (stripped bundle, unsupported platform). The edit
    // itself succeeded; diagnostics are an enhancement, so stay silent.
    return undefined;
  }
  if (errors === undefined || errors.length === 0) return undefined;

  const lineStarts = buildLineStarts(source);
  // Leave room for "9999:9999 " so the position prefix is never truncated away.
  const lineWidth = 120;
  return {
    diagnostics: errors
      .slice(0, MAX_REPORTED)
      .map((error) => toDiagnostic(error, lineStarts, lineWidth)),
    totalCount: errors.length,
  };
}

/**
 * Compact rendering for the tool result: the path once, then one line per
 * error. Deliberately not oxc's `codeframe` — that repeats the filename and a
 * source excerpt on every line, which is pure token cost for a file the model
 * just wrote.
 */
export function formatSyntaxReport(fileName: string, report: SyntaxReport): string {
  const lines = report.diagnostics.map((d) => `  ${String(d.line)}:${String(d.column)} ${d.message}`);
  if (report.totalCount > report.diagnostics.length) {
    lines.push(`  … and ${String(report.totalCount - report.diagnostics.length)} more`);
  }
  return [`Syntax error in ${fileName}:`, ...lines].join('\n');
}
