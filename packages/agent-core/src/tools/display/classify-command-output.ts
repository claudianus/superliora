/**
 * Shell output classifier — turns a recognized command's log dump into a
 * structured {@link ToolResultDisplay} so clients can render a card instead of
 * raw text. The model-visible `output` string is never modified.
 *
 * Detection reads the *output* first and only falls back to the command line,
 * because real commands arrive wrapped (`pnpm -C x exec vitest run … | tail`)
 * and the runner banner is the more reliable signal.
 *
 * Six families are recognized; anything else degrades to `command_output`,
 * which still gives clients an exit code and a bounded tail.
 */

import type { ToolResultDisplay } from './schemas';

export interface ClassifyCommandOutputInput {
  readonly command: string;
  /** Process exit code; `undefined` when the process was killed before exit. */
  readonly exitCode: number | undefined;
  /** Combined stdout+stderr as captured for the tool result. */
  readonly output: string;
  readonly durationMs?: number | undefined;
}

/** Findings kept in the payload; clients decide how many to paint. */
const MAX_FINDINGS = 5;
/** Tail lines carried on the unrecognized `command_output` fallback. */
const FALLBACK_TAIL_LINES = 6;
/** Guard against pathological logs — matchers only scan the head and tail. */
const SCAN_WINDOW_CHARS = 40_000;

interface CheckReport {
  readonly tool: string;
  readonly passed?: number;
  readonly failed?: number;
  readonly skipped?: number;
  readonly warnings?: number;
  readonly summary?: string;
  readonly findings?: readonly { file: string; line?: number; message: string }[];
}

type Matcher = (text: string, command: string) => CheckReport | undefined;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;]*[A-Za-z]/g;

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Keep the head and tail of very large logs. Runner summaries live at the end,
 * error listings at the start, so both windows must survive.
 */
function scanWindow(text: string): string {
  if (text.length <= SCAN_WINDOW_CHARS) return text;
  const half = Math.floor(SCAN_WINDOW_CHARS / 2);
  return `${text.slice(0, half)}\n${text.slice(-half)}`;
}

function trimMessage(message: string): string {
  const flat = message.trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat;
}

// ── Test runners ────────────────────────────────────────────────────────────

const vitestMatcher: Matcher = (text) => {
  // `Tests  2 failed | 237 passed | 1 skipped (240)`
  const tests = /^\s*Tests\s+(.+)$/m.exec(text);
  const files = /^\s*Test Files\s+(.+)$/m.exec(text);
  if (tests === null && files === null) return undefined;
  const line = tests?.[1] ?? files?.[1] ?? '';
  return {
    tool: 'vitest',
    passed: num(/(\d+)\s+passed/.exec(line)?.[1]),
    failed: num(/(\d+)\s+failed/.exec(line)?.[1]),
    skipped: num(/(\d+)\s+(?:skipped|todo)/.exec(line)?.[1]),
    findings: collectVitestFailures(text),
  };
};

function collectVitestFailures(
  text: string,
): readonly { file: string; line?: number; message: string }[] {
  const out: { file: string; line?: number; message: string }[] = [];
  // `FAIL  |proj| test/a.test.ts > suite > case`
  const re = /^\s*(?:❯\s*)?FAIL\s+(?:\|[^|]*\|\s*)?(\S+?)(?:\s*>\s*(.+))?$/gm;
  for (const match of text.matchAll(re)) {
    if (out.length >= MAX_FINDINGS) break;
    const file = match[1];
    if (file === undefined) continue;
    out.push({ file, message: trimMessage(match[2] ?? 'failed') });
  }
  return out;
}

const jestMatcher: Matcher = (text) => {
  // `Tests:       1 failed, 2 passed, 3 total`
  const line = /^Tests:\s+(.+)$/m.exec(text)?.[1];
  if (line === undefined) return undefined;
  return {
    tool: 'jest',
    passed: num(/(\d+)\s+passed/.exec(line)?.[1]),
    failed: num(/(\d+)\s+failed/.exec(line)?.[1]),
    skipped: num(/(\d+)\s+(?:skipped|todo)/.exec(line)?.[1]),
  };
};

const pytestMatcher: Matcher = (text) => {
  // `===== 2 failed, 5 passed, 1 skipped in 1.23s =====`
  const line = /^=+\s*((?:\d+\s+\w+(?:,\s*)?)+)\s*in\s+[\d.]+s.*$/m.exec(text)?.[1];
  if (line === undefined) return undefined;
  return {
    tool: 'pytest',
    passed: num(/(\d+)\s+passed/.exec(line)?.[1]),
    failed: num(/(\d+)\s+(?:failed|error)/.exec(line)?.[1]),
    skipped: num(/(\d+)\s+(?:skipped|deselected)/.exec(line)?.[1]),
  };
};

const goTestMatcher: Matcher = (text, command) => {
  if (!/\bgo\s+test\b/.test(command)) return undefined;
  const failures = [...text.matchAll(/^\s*---\s+FAIL:\s+(\S+)/gm)];
  const passes = [...text.matchAll(/^\s*---\s+PASS:\s+\S+/gm)];
  const skips = [...text.matchAll(/^\s*---\s+SKIP:\s+\S+/gm)];
  if (failures.length === 0 && passes.length === 0 && !/^(?:ok|FAIL)\s/m.test(text)) {
    return undefined;
  }
  return {
    tool: 'go test',
    passed: passes.length,
    failed: failures.length,
    skipped: skips.length,
    findings: failures.slice(0, MAX_FINDINGS).map((match) => ({
      file: match[1] ?? 'test',
      message: 'failed',
    })),
  };
};

const cargoTestMatcher: Matcher = (text) => {
  // `test result: FAILED. 3 passed; 1 failed; 0 ignored; …`
  const line = /^test result:\s+(.+)$/m.exec(text)?.[1];
  if (line === undefined) return undefined;
  return {
    tool: 'cargo test',
    passed: num(/(\d+)\s+passed/.exec(line)?.[1]),
    failed: num(/(\d+)\s+failed/.exec(line)?.[1]),
    skipped: num(/(\d+)\s+ignored/.exec(line)?.[1]),
  };
};

// ── Typecheck ───────────────────────────────────────────────────────────────

const tscMatcher: Matcher = (text, command) => {
  const diagnostics = [...text.matchAll(/^(\S+?)\((\d+),\d+\):\s+error\s+(TS\d+:\s*.+)$/gm)];
  const found = /^Found\s+(\d+)\s+errors?\b/m.exec(text);
  // `Found N errors.` alone is ambiguous (ruff and biome print it too), so the
  // bare-summary path additionally requires a tsc-shaped command.
  const isTscCommand = /\b(?:tsc|typecheck|type-check)\b/.test(command);
  if (diagnostics.length === 0 && (found === null || !isTscCommand)) return undefined;
  const failed = num(found?.[1]) ?? diagnostics.length;
  return {
    tool: 'tsc',
    failed,
    summary: failed === 0 ? 'No type errors' : undefined,
    findings: diagnostics.slice(0, MAX_FINDINGS).map((match) => ({
      file: match[1] ?? '',
      ...(num(match[2]) === undefined ? {} : { line: num(match[2])! }),
      message: trimMessage(match[3] ?? 'error'),
    })),
  };
};

// ── Lint ────────────────────────────────────────────────────────────────────

const eslintMatcher: Matcher = (text) => {
  // `✖ 7 problems (3 errors, 4 warnings)`
  const line = /^\s*[✖✗x]\s+\d+\s+problems?\s+\((.+)\)/m.exec(text)?.[1];
  if (line === undefined) return undefined;
  return {
    tool: 'eslint',
    failed: num(/(\d+)\s+errors?/.exec(line)?.[1]),
    warnings: num(/(\d+)\s+warnings?/.exec(line)?.[1]),
    findings: collectEslintFindings(text),
  };
};

function collectEslintFindings(
  text: string,
): readonly { file: string; line?: number; message: string }[] {
  const out: { file: string; line?: number; message: string }[] = [];
  let currentFile = '';
  for (const raw of text.split('\n')) {
    if (out.length >= MAX_FINDINGS) break;
    if (raw.startsWith('/') || /^[A-Za-z]:\\/.test(raw)) {
      currentFile = raw.trim();
      continue;
    }
    // `  12:3  error  Unexpected any  @typescript-eslint/no-explicit-any`
    const row = /^\s+(\d+):\d+\s+error\s+(.+?)(?:\s{2,}\S+)?$/.exec(raw);
    if (row === null || currentFile.length === 0) continue;
    out.push({
      file: currentFile,
      ...(num(row[1]) === undefined ? {} : { line: num(row[1])! }),
      message: trimMessage(row[2] ?? 'error'),
    });
  }
  return out;
}

const ruffBiomeMatcher: Matcher = (text, command) => {
  if (!/\b(?:ruff|biome)\b/.test(command)) return undefined;
  const found = /^(?:Found|Checked)\s+(\d+)\s+(?:errors?|diagnostics?)/m.exec(text);
  if (found === null) return undefined;
  return {
    tool: /\bruff\b/.test(command) ? 'ruff' : 'biome',
    failed: num(found[1]),
  };
};

// ── Build ───────────────────────────────────────────────────────────────────

const buildMatcher: Matcher = (text, command) => {
  if (!/\b(?:build|tsup|vite build|next build|rollup|esbuild)\b/.test(command)) return undefined;
  const errors = [...text.matchAll(/^(?:.*\b)?(?:ERROR|error):\s*(.+)$/gm)];
  return {
    tool: 'build',
    failed: errors.length,
    summary: errors.length === 0 ? 'Build finished' : undefined,
    findings: errors.slice(0, MAX_FINDINGS).map((match) => ({
      file: 'build',
      message: trimMessage(match[1] ?? 'error'),
    })),
  };
};

// ── git ─────────────────────────────────────────────────────────────────────

const gitMatcher: Matcher = (text, command) => {
  if (!/\bgit\b/.test(command)) return undefined;
  // `3 files changed, 42 insertions(+), 10 deletions(-)`
  const stat = /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/.exec(
    text,
  );
  if (stat !== null) {
    const parts = [`${stat[1] ?? '0'} files`];
    if (stat[2] !== undefined) parts.push(`+${stat[2]}`);
    if (stat[3] !== undefined) parts.push(`−${stat[3]}`);
    return { tool: 'git', summary: parts.join(' · ') };
  }
  const porcelain = [...text.matchAll(/^([ MADRCU?!]{2})\s+(.+)$/gm)];
  if (porcelain.length > 0) {
    return {
      tool: 'git',
      summary: `${String(porcelain.length)} changed path${porcelain.length === 1 ? '' : 's'}`,
      findings: porcelain.slice(0, MAX_FINDINGS).map((match) => ({
        file: (match[2] ?? '').trim(),
        message: (match[1] ?? '').trim() || 'modified',
      })),
    };
  }
  if (/^nothing to commit/m.test(text) || /working tree clean/m.test(text)) {
    return { tool: 'git', summary: 'Working tree clean' };
  }
  return undefined;
};

// ── Package install ─────────────────────────────────────────────────────────

const installMatcher: Matcher = (text, command) => {
  if (!/\b(?:pnpm|npm|yarn|bun)\b.*\b(?:install|add|i|ci)\b/.test(command)) return undefined;
  // pnpm: `Packages: +12`  ·  npm: `added 12 packages`
  const added = num(
    /Packages:\s*\+(\d+)/.exec(text)?.[1] ?? /added\s+(\d+)\s+packages?/.exec(text)?.[1],
  );
  const removed = num(
    /Packages:\s*-(\d+)/.exec(text)?.[1] ?? /removed\s+(\d+)\s+packages?/.exec(text)?.[1],
  );
  if (added === undefined && removed === undefined) {
    if (!/(?:Already up to date|up to date|Done in)/.test(text)) return undefined;
    return { tool: 'install', summary: 'Already up to date' };
  }
  const parts: string[] = [];
  if (added !== undefined) parts.push(`+${String(added)} packages`);
  if (removed !== undefined) parts.push(`−${String(removed)} packages`);
  return { tool: 'install', summary: parts.join(' · ') };
};

/**
 * Order matters: specific runner banners before the broad `build` and `git`
 * matchers, because a failing `pnpm build` log also contains `error:` lines and
 * a `git`-prefixed command can wrap anything.
 */
const MATCHERS: readonly Matcher[] = [
  vitestMatcher,
  jestMatcher,
  pytestMatcher,
  cargoTestMatcher,
  goTestMatcher,
  tscMatcher,
  eslintMatcher,
  ruffBiomeMatcher,
  installMatcher,
  gitMatcher,
  buildMatcher,
];

export function classifyCommandOutput(
  input: ClassifyCommandOutputInput,
): ToolResultDisplay {
  const text = scanWindow(input.output.replace(ANSI_RE, ''));
  const exitCode = input.exitCode ?? -1;

  for (const matcher of MATCHERS) {
    const report = matcher(text, input.command);
    if (report === undefined) continue;
    return {
      kind: 'check_report',
      tool: report.tool,
      exit_code: exitCode,
      ...(report.passed === undefined ? {} : { passed: report.passed }),
      ...(report.failed === undefined ? {} : { failed: report.failed }),
      ...(report.skipped === undefined ? {} : { skipped: report.skipped }),
      ...(report.warnings === undefined ? {} : { warnings: report.warnings }),
      ...(input.durationMs === undefined ? {} : { duration_ms: input.durationMs }),
      ...(report.summary === undefined ? {} : { summary: report.summary }),
      ...(report.findings === undefined || report.findings.length === 0
        ? {}
        : { findings: [...report.findings] }),
    };
  }

  return {
    kind: 'command_output',
    exit_code: exitCode,
    stdout: tailLines(text, FALLBACK_TAIL_LINES),
  };
}

function tailLines(text: string, count: number): string {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(-count).join('\n');
}
