/**
 * Worker security guards for Conductor execution lane.
 * - No git push / force-push from workers
 * - Prefer worktree-root writes (caller may combine with kaos path guards)
 * - Refuse whole-package test suites when the job brief pins focused files
 */

export interface WorkerShellGuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
  /** When set, Bash should run this instead of the original command. */
  readonly rewrittenCommand?: string;
}

/** Detect remote-mutating git commands that workers must not run. */
export function isWorkerForbiddenGitRemoteCommand(command: string): boolean {
  const c = command.trim();
  if (c.length === 0) return false;
  // git push / git push --force / git push origin HEAD etc.
  if (/(?:^|[;&|\n]|&&|\|\|)\s*git\s+push\b/i.test(c)) return true;
  // gh pr merge --admin that pushes; keep narrow: git push only per product lock
  if (/(?:^|[;&|\n]|&&|\|\|)\s*git\s+send-pack\b/i.test(c)) return true;
  return false;
}

/**
 * True when a shell command expands to a whole package test directory without
 * a specific test file (the suite-waste pattern that burns the 30m wall-clock).
 *
 * Examples that match:
 * - `node scripts/test-local.mjs apps/liora/test/tui`
 * - `node scripts/test-local.mjs packages/agent-core/test`
 * - `pnpm exec vitest run packages/agent-core/test`
 *
 * Examples that do NOT match (focused file still present):
 * - `node scripts/test-local.mjs packages/agent-core/test/tools/job-worker-guards.test.ts`
 * - `node scripts/test-local.mjs packages/agent-core/test/tools -t "guard"`
 *   (still suite-level dir — matches; only a concrete file path is focused)
 */
export function isWholePackageTestCommand(command: string): boolean {
  const c = command.trim();
  if (c.length === 0) return false;

  // Known package test roots (dir only — trailing file segment means focused).
  const packageRoots = [
    'apps/liora/test/tui',
    'apps/liora/test',
    'packages/agent-core/test',
    'packages/node-sdk/test',
    'packages/server/test',
    'packages/server-e2e/test',
  ];

  for (const root of packageRoots) {
    // Match the root as a path token, not as a prefix of a deeper file path.
    // `.../test/tui` matches; `.../test/tui/foo.test.ts` does not.
    const rootEscaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // End of command, whitespace, quote, or shell operator after the root.
    const dirOnly = new RegExp(
      `(?:^|[\\s"'])${rootEscaped}(?=(?:\\s|"|'|$|[;&|]))`,
      'i',
    );
    if (!dirOnly.test(c)) continue;
    // If a deeper path under the root is present (file with extension), allow.
    const deeperFile = new RegExp(
      `${rootEscaped}/[^\\s"'|;&]+\\.(?:ts|tsx|js|mjs|cjs|jsx)\\b`,
      'i',
    );
    if (deeperFile.test(c)) continue;
    // `-t "case"` still runs the whole dir — still waste for our purposes.
    // Only a concrete file path counts as focused.
    return true;
  }

  // Bare package suite via pnpm workspace without a file path.
  if (
    /\b(?:pnpm|npm|yarn)\b[\s\S]*?\b(?:test:local|test:all|test)\b/i.test(c) &&
    !/\.(?:ts|tsx|js|mjs|cjs)\b/.test(c) &&
    /(?:apps\/liora|packages\/(?:agent-core|node-sdk|server(?:-e2e)?))\b/.test(c)
  ) {
    return true;
  }

  return false;
}

/**
 * True when a command references a concrete test/source file path (not the
 * test-local.mjs runner script itself, and not a bare package test directory).
 */
function commandReferencesTestFile(command: string): boolean {
  // Strip the well-known runner so `scripts/test-local.mjs` is not mistaken
  // for a focused test path.
  const withoutRunner = command
    .replace(/\b(?:node\s+)?scripts\/test-local\.mjs\b/gi, ' ')
    .replace(/\b(?:node\s+)?scripts\\test-local\.mjs\b/gi, ' ');
  // Concrete file under a package/app path, or any *.test.* / *.spec.* path.
  if (
    /(?:^|[\s"'])(?:apps|packages)\/[^\s"'|;&]+\.(?:ts|tsx|js|mjs|cjs|jsx)\b/i.test(
      withoutRunner,
    )
  ) {
    return true;
  }
  if (/\.(?:test|spec)\.(?:ts|tsx|js|mjs|cjs|jsx)\b/i.test(withoutRunner)) {
    return true;
  }
  return false;
}

/**
 * True when brief.verification_commands list at least one path that looks like
 * a specific test file (has an extension) rather than a package root only.
 */
export function verificationCommandsPinSpecificFiles(
  verificationCommands: readonly string[] | undefined,
): boolean {
  if (verificationCommands === undefined || verificationCommands.length === 0) {
    return false;
  }
  return verificationCommands.some((cmd) => {
    if (commandReferencesTestFile(cmd)) return true;
    // Explicit `-t` / test name pattern still counts as focused intent.
    if (/\s-t\s+/.test(cmd) || /--testNamePattern\b/.test(cmd)) {
      return true;
    }
    return false;
  });
}

/**
 * Prefer the first verification command that still looks focused when rewriting
 * a whole-package suite expansion.
 */
export function pickFocusedVerificationRewrite(
  verificationCommands: readonly string[],
): string | undefined {
  for (const cmd of verificationCommands) {
    const trimmed = cmd.trim();
    if (trimmed.length === 0) continue;
    if (isWholePackageTestCommand(trimmed)) continue;
    if (commandReferencesTestFile(trimmed) || /\s-t\s+/.test(trimmed)) {
      return trimmed;
    }
  }
  // Fall back to first non-empty non-suite command.
  for (const cmd of verificationCommands) {
    const trimmed = cmd.trim();
    if (trimmed.length === 0) continue;
    if (!isWholePackageTestCommand(trimmed)) return trimmed;
  }
  return undefined;
}

export function guardWorkerShellCommand(
  command: string,
  options?: {
    readonly isWorker?: boolean;
    /** Job brief verification_commands — when focused files are listed, suite expansion is blocked. */
    readonly verificationCommands?: readonly string[];
  },
): WorkerShellGuardResult {
  if (options?.isWorker !== true) {
    return { allowed: true };
  }
  if (isWorkerForbiddenGitRemoteCommand(command)) {
    return {
      allowed: false,
      reason:
        'Conductor workers must not push (or force-push) to remotes. Local commits in the job worktree are OK; remote publish is PushJob / Push Preview (user-gated offload).',
    };
  }

  const verificationCommands = options.verificationCommands;
  if (
    verificationCommandsPinSpecificFiles(verificationCommands) &&
    isWholePackageTestCommand(command)
  ) {
    const rewrite =
      verificationCommands !== undefined
        ? pickFocusedVerificationRewrite(verificationCommands)
        : undefined;
    if (rewrite !== undefined && rewrite !== command.trim()) {
      return {
        allowed: true,
        rewrittenCommand: rewrite,
        reason:
          `suite_guard: refused whole-package test suite expansion; rewrote to focused brief.verification_commands entry. ` +
          `original=${JSON.stringify(command.trim().slice(0, 200))} ` +
          `rewrite=${JSON.stringify(rewrite.slice(0, 200))}`,
      };
    }
    return {
      allowed: false,
      reason:
        `suite_guard: refused whole-package test suite because brief.verification_commands pins specific files. ` +
        `Do not run apps/liora/test/tui or packages/agent-core/test without a file path. ` +
        `Use the brief verification_commands entry instead. ` +
        `command=${JSON.stringify(command.trim().slice(0, 240))}`,
    };
  }

  return { allowed: true };
}

/**
 * True when path escapes job worktree root (string prefix check; resolve before call).
 */
export function isPathOutsideWorktree(worktreeRoot: string, targetPath: string): boolean {
  const root = worktreeRoot.replace(/\/+$/, '');
  const target = targetPath;
  if (root.length === 0) return false;
  if (target === root) return false;
  if (target.startsWith(`${root}/`)) return false;
  // relative that clearly walks up
  if (target.startsWith('..')) return true;
  // absolute different prefix
  if (target.startsWith('/') && !target.startsWith(`${root}/`) && target !== root) {
    return true;
  }
  return false;
}

/** Tool-count budget before verification_commands must have run (pre-abort). */
export const WORKER_VERIFICATION_TOOL_BUDGET = 10;

/** Consecutive Read/Grep-only tools that count as an explore-only loop. */
export const WORKER_READ_GREP_LOOP_MIN = 6;

export interface WorkerVerificationGuardResult {
  readonly abort: boolean;
  readonly reason?: string;
}

function normalizeRecentToolName(entry: string): string {
  const raw = entry.trim();
  if (raw.length === 0) return '';
  // "Bash: cmd" / "Read: path" → tool name only.
  const colon = raw.indexOf(':');
  if (colon > 0) return raw.slice(0, colon).trim().toLowerCase();
  return raw.toLowerCase();
}

function recentToolsRanVerificationCommand(
  recentTools: readonly string[] | undefined,
  verificationCommands: readonly string[],
): boolean {
  if (recentTools === undefined || recentTools.length === 0) return false;
  const needles = verificationCommands
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((c) => c.toLowerCase());
  if (needles.length === 0) return false;
  for (const entry of recentTools) {
    const hay = entry.toLowerCase();
    for (const needle of needles) {
      // Match full command or a distinctive file path fragment from it.
      if (hay.includes(needle)) return true;
      const fileHit = needle.match(
        /(?:apps|packages)\/[^\s"'|;&]+\.(?:ts|tsx|js|mjs|cjs|jsx)\b/i,
      );
      if (fileHit?.[0] !== undefined && hay.includes(fileHit[0].toLowerCase())) return true;
    }
  }
  return false;
}

function isReadGrepOnlyLoop(recentTools: readonly string[] | undefined): boolean {
  if (recentTools === undefined || recentTools.length < WORKER_READ_GREP_LOOP_MIN) {
    return false;
  }
  const window = recentTools.slice(-WORKER_READ_GREP_LOOP_MIN);
  return window.every((entry) => {
    const name = normalizeRecentToolName(entry);
    return name === 'read' || name === 'grep' || name === 'glob' || name === 'repoquery';
  });
}

/**
 * Pre-abort when a job lists verification_commands but the worker never runs
 * them within N tools, or only Read/Grep-loops. Pure — caller flips status.
 */
export function evaluateWorkerVerificationGuard(input: {
  readonly verificationCommands: readonly string[] | undefined;
  readonly toolCount: number;
  readonly recentTools?: readonly string[];
  readonly toolBudget?: number;
}): WorkerVerificationGuardResult {
  const commands = input.verificationCommands?.filter((c) => c.trim().length > 0) ?? [];
  if (commands.length === 0) return { abort: false };

  if (recentToolsRanVerificationCommand(input.recentTools, commands)) {
    return { abort: false };
  }

  if (isReadGrepOnlyLoop(input.recentTools)) {
    return {
      abort: true,
      reason:
        'verification_guard: explore-only Read/Grep loop while verification_commands are listed — pre-abort and run the brief checks (or hand off).',
    };
  }

  const budget = input.toolBudget ?? WORKER_VERIFICATION_TOOL_BUDGET;
  if (input.toolCount >= budget) {
    return {
      abort: true,
      reason:
        `verification_guard: verification_commands not run within ${budget} tools — pre-abort. ` +
        `Run: ${commands[0]!.slice(0, 200)}`,
    };
  }

  return { abort: false };
}
