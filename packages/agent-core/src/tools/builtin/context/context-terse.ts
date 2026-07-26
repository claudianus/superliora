import type { SymbolEntry } from './context-types';

export type LioraReadMode = 'auto' | 'full' | 'signatures' | 'map' | 'lines';

export interface TerseReadInput {
  readonly content: string;
  readonly displayPath: string;
  readonly mode: LioraReadMode;
  readonly startLine?: number | undefined;
  readonly limit?: number | undefined;
  readonly maxChars?: number | undefined;
}

export interface TerseReadResult {
  readonly text: string;
  readonly lineCount: number;
  readonly renderedLines: number;
  readonly modeUsed: LioraReadMode;
  readonly overflow: string | undefined;
}

const DEFAULT_MAX_CHARS = 4000;
/** Prefer signatures sooner — full dumps thrash long-horizon context. */
const AUTO_FULL_LINE_THRESHOLD = 80;
/** Shell stdout after pattern collapse — match tool-result 4k budget. */
export const SHELL_COMPRESS_DEFAULT_MAX_CHARS = 4_000;

export function renderTerseRead(input: TerseReadInput): TerseReadResult {
  const lines = input.content.split(/\r?\n/);
  const mode = resolveMode(input.mode, lines.length);
  if (mode === 'lines') {
    return renderLineWindow(lines, input);
  }
  if (mode === 'signatures' || mode === 'map') {
    return renderSymbolView(lines, input.displayPath, mode, input.maxChars ?? DEFAULT_MAX_CHARS);
  }
  return renderFullView(lines, input.displayPath, mode, input.maxChars ?? DEFAULT_MAX_CHARS);
}

function resolveMode(mode: LioraReadMode, lineCount: number): LioraReadMode {
  if (mode !== 'auto') return mode;
  return lineCount <= AUTO_FULL_LINE_THRESHOLD ? 'full' : 'signatures';
}

function renderLineWindow(lines: readonly string[], input: TerseReadInput): TerseReadResult {
  const start = Math.max(1, input.startLine ?? 1);
  const limit = Math.max(1, input.limit ?? 80);
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const selected = lines.slice(start - 1, start - 1 + limit);
  const rendered: string[] = [
    `<liora_read mode="lines" path="${input.displayPath}">`,
    `window: ${String(start)}-${String(start + selected.length - 1)} of ${String(lines.length)}`,
  ];
  let chars = rendered.join('\n').length;
  for (const [index, line] of selected.entries()) {
    const row = `${String(start + index)}\t${line}`;
    if (chars + row.length + 1 > maxChars) break;
    rendered.push(row);
    chars += row.length + 1;
  }
  rendered.push('</liora_read>');
  const text = rendered.join('\n');
  const overflow =
    text.length < input.content.length ? input.content.slice(text.length) : undefined;
  return {
    text,
    lineCount: lines.length,
    renderedLines: selected.length,
    modeUsed: 'lines',
    overflow,
  };
}

function renderSymbolView(
  lines: readonly string[],
  displayPath: string,
  mode: 'signatures' | 'map',
  maxChars: number,
): TerseReadResult {
  const content = lines.join('\n');
  const symbols = extractSymbolsFromContent(content);
  const rendered: string[] = [
    `<liora_read mode="${mode}" path="${displayPath}">`,
    `lines: ${String(lines.length)}`,
    'symbols:',
  ];
  for (const symbol of symbols) {
    rendered.push(`- L${String(symbol.line)} ${symbol.kind} ${symbol.name}: ${symbol.signature}`);
  }
  if (mode === 'map') {
    rendered.push('structure: imports/exports only — use mode=full or LioraRead mode=lines for bodies.');
  }
  rendered.push('</liora_read>');
  let text = rendered.join('\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 20) + '\n[...truncated]';
  }
  return {
    text,
    lineCount: lines.length,
    renderedLines: symbols.length,
    modeUsed: mode,
    overflow: content,
  };
}

function renderFullView(
  lines: readonly string[],
  displayPath: string,
  modeUsed: LioraReadMode,
  maxChars: number,
): TerseReadResult {
  const rendered: string[] = [`<liora_read mode="full" path="${displayPath}">`];
  let chars = rendered[0]?.length ?? 0;
  let renderedLines = 0;
  for (const [index, line] of lines.entries()) {
    const row = `${String(index + 1)}\t${line}`;
    if (chars + row.length + 1 > maxChars) break;
    rendered.push(row);
    chars += row.length + 1;
    renderedLines += 1;
  }
  const truncated = renderedLines < lines.length;
  if (truncated) rendered.push('[...truncated — use LioraExpand or LioraRead mode=lines]');
  rendered.push('</liora_read>');
  const text = rendered.join('\n');
  return {
    text,
    lineCount: lines.length,
    renderedLines,
    modeUsed,
    overflow: truncated ? lines.slice(renderedLines).join('\n') : undefined,
  };
}

function extractSymbolsFromContent(content: string): SymbolEntry[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => extractSymbols(line, index + 1))
    .flat()
    .filter((symbol): symbol is SymbolEntry => symbol !== undefined);
}

function extractSymbols(line: string, lineNumber: number): SymbolEntry | undefined {
  const trimmed = line.trim();
  const patterns: ReadonlyArray<readonly [RegExp, string, number]> = [
    [/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/, 'class', 1],
    [/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, 'interface', 1],
    [/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/, 'type', 1],
    [/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
    [/^def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/, 'function', 1],
  ];
  for (const [pattern, kind, group] of patterns) {
    const match = pattern.exec(trimmed);
    if (match !== null) {
      return {
        line: lineNumber,
        kind,
        name: match[group] ?? '(anonymous)',
        signature: trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed,
      };
    }
  }
  return undefined;
}

export interface CompressShellOutputInput {
  readonly stdout: string;
  readonly stderr: string;
  readonly command: string;
  readonly maxChars?: number | undefined;
}

export interface CompressShellOutputResult {
  readonly text: string;
  readonly savedPercent: number;
  readonly overflow: string | undefined;
}

export function compressShellOutput(
  input: CompressShellOutputInput & { readonly exitCode?: number | undefined },
): CompressShellOutputResult {
  const raw = mergeShellStreams(input.stdout, input.stderr);
  if (raw.length === 0) {
    return { text: '(no output)', savedPercent: 0, overflow: undefined };
  }
  if (input.exitCode !== undefined && input.exitCode !== 0) {
    return { text: raw, savedPercent: 0, overflow: undefined };
  }
  const maxChars = input.maxChars ?? SHELL_COMPRESS_DEFAULT_MAX_CHARS;
  const normalized = collapseRepeatedBlankLines(raw);
  const patternCompressed = applyShellPatterns(normalized, input.command);
  const deduped = collapseConsecutiveDuplicateLines(patternCompressed);
  if (deduped.length <= maxChars) {
    const savedPercent =
      raw.length === 0 ? 0 : Math.max(0, Math.round((1 - deduped.length / raw.length) * 100));
    return { text: deduped, savedPercent, overflow: undefined };
  }
  const head = deduped.slice(0, Math.floor(maxChars * 0.7));
  const tail = deduped.slice(-Math.floor(maxChars * 0.25));
  const text = `${head}\n[...${String(deduped.length - head.length - tail.length)} chars omitted...]\n${tail}`;
  const savedPercent = Math.max(0, Math.round((1 - text.length / raw.length) * 100));
  return { text, savedPercent, overflow: deduped };
}

function mergeShellStreams(stdout: string, stderr: string): string {
  if (stdout.length === 0) return stderr;
  if (stderr.length === 0) return stdout;
  return `${stdout}${stdout.endsWith('\n') ? '' : '\n'}--- stderr ---\n${stderr}`;
}

function collapseRepeatedBlankLines(text: string): string {
  return text.replace(/\n{4,}/g, '\n\n\n');
}

function collapseConsecutiveDuplicateLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let previous = '';
  let repeatCount = 0;
  for (const line of lines) {
    if (line === previous) {
      repeatCount += 1;
      continue;
    }
    if (repeatCount > 0) {
      result.push(`[... repeated "${truncateInline(previous, 60)}" ${String(repeatCount + 1)} times]`);
      repeatCount = 0;
    }
    result.push(line);
    previous = line;
  }
  if (repeatCount > 0) {
    result.push(`[... repeated "${truncateInline(previous, 60)}" ${String(repeatCount + 1)} times]`);
  }
  return result.join('\n');
}

function applyShellPatterns(text: string, command: string): string {
  let next = text;
  if (/\bgit\s+status\b/u.test(command)) {
    next = compressGitStatusOutput(next);
  }
  if (/\b(?:pnpm|npm|yarn)\s+(?:test|run\s+test)\b/u.test(command)) {
    next = compressTestOutput(next);
  }
  if (/\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:build|lint|check)\b/u.test(command)) {
    next = compressBuildOutput(next);
  }
  // Frontend / bundler dumps are mostly chunk lines — use head+tail, not test-pass collapse.
  if (
    /\b(?:next|nuxt|astro)\s+build\b/u.test(command) ||
    /\b(?:vite|webpack|esbuild|rollup|parcel)\b[^\n]*\b(?:build|--mode)\b/u.test(command) ||
    /\bturbo\s+run\s+build\b/u.test(command) ||
    /\bwebpack\s+--mode\b/u.test(command)
  ) {
    next = compressCompilerOutput(next);
  }
  if (/\b(?:cargo|pnpm|npm|yarn)\s+(?:test|run\s+test)\b/u.test(command)) {
    next = compressTestOutput(next);
  }
  if (/\bcargo\s+(?:build|test|check|clippy)\b/u.test(command)) {
    next = compressBuildOutput(next);
  }
  if (
    /\bgit\s+(?:log|diff|show|blame|shortlog|stash\s+show|whatchanged)\b/u.test(command) ||
    /\bgit\s+(?:diff|show|log)\b[^\n]*--(?:name-status|stat|numstat|shortstat)\b/u.test(command)
  ) {
    next = compressGitOutput(next, command);
  }
  if (/\bdocker\s+(?:ps|logs|compose)\b/u.test(command)) {
    next = compressDockerOutput(next);
  }
  if (/\b(?:vitest|jest|pytest)\b/u.test(command) || /\b(?:vitest|jest|pytest)\b/u.test(text)) {
    next = compressTestOutput(next);
  }
  if (/\bgo\s+test\b/u.test(command) || /^--- (?:PASS|FAIL|SKIP):/mu.test(text)) {
    next = compressTestOutput(next);
  }
  // cargo test lines: `test foo::bar ... ok` (also covered by cargo build/test above,
  // but force test collapse when the command is cargo test specifically).
  if (/\bcargo\s+test\b/u.test(command) || /^test\s+\S.+\s+\.\.\.\s+(?:ok|FAILED)\b/mu.test(text)) {
    next = compressTestOutput(next);
  }
  // TypeScript / ESLint / oxlint / biome / clippy / formatter dumps: head+tail.
  if (
    /\b(?:tsc|eslint|oxlint|oxfmt|ruff|mypy|pyright|ty|biome|clippy|prettier|black|isort|rustfmt|gofmt|clang-format)\b/u.test(
      command,
    ) ||
    /\b(?:pnpm|npm|yarn)\s+(?:exec\s+)?(?:tsc|eslint|oxlint|oxfmt|ruff|mypy|biome|prettier)\b/u.test(
      command,
    ) ||
    /\bcargo\s+(?:clippy|fmt)\b/u.test(command) ||
    /\bpython(?:3(?:\.\d+)?)?\s+-m\s+(?:black|isort)\b/u.test(command) ||
    /\berror TS\d+:/u.test(text)
  ) {
    next = compressCompilerOutput(next);
  }
  if (/\brg\b/u.test(command) || /\bripgrep\b/u.test(command)) {
    next = compressRipgrepOutput(next);
  }
  // Package / dependency trees are huge and rarely need full fidelity mid-run.
  if (
    /\b(?:pnpm|npm|yarn)\s+(?:list|ls|why|outdated|audit)\b/u.test(command) ||
    /\bcargo\s+(?:tree|audit)\b/u.test(command) ||
    /\bgo\s+mod\s+(?:graph|why|download)\b/u.test(command) ||
    /\bpip(?:3)?\s+(?:list|freeze|show)\b/u.test(command) ||
    /\bbun\s+pm\s+ls\b/u.test(command)
  ) {
    next = compressDependencyTreeOutput(next);
  }
  return next;
}

function compressGitStatusOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 40) return text;
  const head = lines.slice(0, 25);
  const tail = lines.slice(-10);
  return [...head, `[... ${String(lines.length - 35)} git status lines omitted ...]`, ...tail].join('\n');
}

function compressBuildOutput(text: string): string {
  return compressTestOutput(text);
}

/** Long tsc/eslint/oxlint dumps: keep head + tail, omit the middle. */
function compressCompilerOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 80) return text;
  const head = lines.slice(0, 50);
  const tail = lines.slice(-20);
  return [
    ...head,
    `[... ${String(lines.length - 70)} compiler/linter lines omitted ...]`,
    ...tail,
  ].join('\n');
}

function compressDockerOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 60) return text;
  return [...lines.slice(0, 40), `[... ${String(lines.length - 50)} docker lines omitted ...]`, ...lines.slice(-10)].join('\n');
}

function compressRipgrepOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 80) return text;
  return [...lines.slice(0, 60), `[... ${String(lines.length - 70)} rg lines omitted ...]`, ...lines.slice(-10)].join('\n');
}

/** pnpm/npm/yarn list|why, cargo tree, pip freeze — keep head+tail. */
function compressDependencyTreeOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 60) return text;
  const head = lines.slice(0, 40);
  const tail = lines.slice(-15);
  return [
    ...head,
    `[... ${String(lines.length - 55)} dependency tree lines omitted ...]`,
    ...tail,
  ].join('\n');
}

function compressTestOutput(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let passingRun = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const isPass =
      /^(?:PASS|✓|✔|\s*ok\s+\d+\s+-)/u.test(trimmed) ||
      /^--- PASS:/u.test(trimmed) ||
      /^ok\s+/u.test(trimmed) ||
      // cargo / libtest: `test foo::bar ... ok`
      /^test\s+\S.+\s+\.\.\.\s+ok\b/u.test(trimmed) ||
      /\bpassed\b/iu.test(trimmed) ||
      /\b✓\b/u.test(trimmed);
    const isFail =
      /^(?:FAIL|✗|×|\s*not ok\b)/u.test(trimmed) ||
      /^--- FAIL:/u.test(trimmed) ||
      // cargo / libtest: `test foo::bar ... FAILED`
      /^test\s+\S.+\s+\.\.\.\s+FAILED\b/u.test(trimmed) ||
      /\bfailed\b/iu.test(trimmed) ||
      /\berror\b/iu.test(trimmed);
    if (isFail) {
      if (passingRun > 3) kept.push(`[... ${String(passingRun)} passing tests omitted]`);
      passingRun = 0;
      kept.push(line);
      continue;
    }
    if (isPass) {
      passingRun += 1;
      continue;
    }
    if (passingRun > 3) {
      kept.push(`[... ${String(passingRun)} passing tests omitted]`);
      passingRun = 0;
    }
    kept.push(line);
  }
  if (passingRun > 3) kept.push(`[... ${String(passingRun)} passing tests omitted]`);
  return kept.join('\n');
}

/**
 * Compress long git log/diff/show/blame dumps.
 * Diffs keep file headers + hunk headers and collapse pure context/body runs.
 * Other git dumps use a tighter head+tail window than the generic shell cap.
 */
function compressGitOutput(text: string, command = ''): string {
  const lines = text.split('\n');
  const isDiffLike =
    /\bgit\s+(?:diff|show|stash\s+show)\b/u.test(command) ||
    /^diff --git /m.test(text) ||
    /^@@ /m.test(text);

  if (isDiffLike && lines.length > 40) {
    return compressGitDiffOutput(lines);
  }

  // log / blame / shortlog / name-status — keep head+tail with a tighter budget.
  if (lines.length <= AUTO_FULL_LINE_THRESHOLD) return text;
  const headCount = 40;
  const tailCount = 20;
  if (lines.length <= headCount + tailCount) return text;
  const head = lines.slice(0, headCount);
  const tail = lines.slice(-tailCount);
  return [
    ...head,
    `[... ${String(lines.length - headCount - tailCount)} git lines omitted ...]`,
    ...tail,
  ].join('\n');
}

/** Keep file/hunk headers; keep first 8 body lines per hunk, omit the rest. */
function compressGitDiffOutput(lines: readonly string[]): string {
  const kept: string[] = [];
  let bodyRun = 0;

  const flushOmittedBody = (): void => {
    if (bodyRun > 8) {
      kept.push(`[... ${String(bodyRun - 8)} diff body lines omitted ...]`);
    }
    bodyRun = 0;
  };

  for (const line of lines) {
    const isHeader =
      /^(?:diff --git |index |--- |\+\+\+ |@@ |new file mode |deleted file mode |rename |similarity |Binary files )/u.test(
        line,
      ) || /^(?:commit |Author:|Date:|Merge:)/u.test(line);
    if (isHeader) {
      flushOmittedBody();
      kept.push(line);
      continue;
    }
    bodyRun += 1;
    if (bodyRun <= 8) {
      kept.push(line);
    }
  }
  flushOmittedBody();

  if (kept.length > 200) {
    const head = kept.slice(0, 120);
    const tail = kept.slice(-40);
    return [
      ...head,
      `[... ${String(kept.length - 160)} git lines omitted ...]`,
      ...tail,
    ].join('\n');
  }
  return kept.join('\n');
}

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
