/**
 * Detect shell commands that are pure file I/O / search and should use
 * dedicated tools (Read, Write, Edit, Grep, Glob) instead of Bash.
 *
 * Only matches **whole-command** simple shapes — pipelines, `&&` chains,
 * subshells, and real process work are allowed through. False positives
 * would break legitimate scripts; false negatives only leave power idle.
 */

export type ShellDedicatedBypassHit = {
  readonly prefer: 'Read' | 'Write' | 'Edit' | 'Grep' | 'Glob';
  readonly pattern: string;
  readonly message: string;
};

/** Prefix a command with this env assignment to force Bash (escape hatch). */
export const SHELL_DEDICATED_BYPASS_FORCE_PREFIX = 'LIORA_FORCE_BASH=1';

/**
 * Returns a hit when the command is a dedicated-tool equivalent.
 * Undefined means allow Bash.
 */
export function detectShellDedicatedBypass(
  command: string,
): ShellDedicatedBypassHit | undefined {
  const raw = command.trim();
  if (raw.length === 0) return undefined;

  // Explicit escape hatch for rare cases where shell file I/O is intentional.
  if (
    raw.startsWith(`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} `) ||
    raw.startsWith(`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX}\t`) ||
    raw.includes(` ${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} `)
  ) {
    return undefined;
  }

  // Multi-statement / pipeline / redirection chains → real shell work.
  if (hasShellComposition(raw)) return undefined;

  // Strip a single outer `cd dir &&` wrapper only if the rest is still simple
  // — actually composition already rejects `&&`. Good.

  const readHit = matchReadLike(raw);
  if (readHit !== undefined) return readHit;

  const writeHit = matchWriteLike(raw);
  if (writeHit !== undefined) return writeHit;

  const editHit = matchEditLike(raw);
  if (editHit !== undefined) return editHit;

  const grepHit = matchGrepLike(raw);
  if (grepHit !== undefined) return grepHit;

  const globHit = matchGlobLike(raw);
  if (globHit !== undefined) return globHit;

  return undefined;
}

export function formatShellDedicatedBypassError(hit: ShellDedicatedBypassHit): string {
  return [
    `Bash blocked: this looks like a job for the ${hit.prefer} tool (${hit.pattern}).`,
    hit.message,
    `If you truly need the shell for this, prefix with \`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} \` and explain why in description.`,
  ].join(' ');
}

function hasShellComposition(command: string): boolean {
  // Pipes, sequential/parallel lists, subshells, process substitution, redirects.
  // Allow simple `2>/dev/null` on a single utility? Still composition — skip deny.
  if (/[|;&`\n]/.test(command)) return true;
  if (/\b(?:&&|\|\|)\b/.test(command)) return true;
  if (/[<>]/.test(command)) return true;
  if (/\$\(|\$\{/.test(command)) return true;
  return false;
}

function matchReadLike(command: string): ShellDedicatedBypassHit | undefined {
  // cat [flags] path
  if (/^(?:\/usr\/bin\/)?cat(?:\s+-[A-Za-z]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'cat file',
      message: 'Use Read (edit-ready bytes) or LioraRead (signatures/map/lines) instead of cat.',
    };
  }
  // head/tail [flags] path — not head of a pipeline
  // Flags may take a following value token: head -n 20 file, tail -50 file, head -n20 file
  if (/^(?:\/usr\/bin\/)?(?:head|tail)(?:\s+-[A-Za-z0-9]+(?:\s+\d+)?)*(?:\s+\S+)\s*$/.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'head/tail file',
      message: 'Use Read with line_offset/n_lines (or LioraRead mode=lines) instead of head/tail.',
    };
  }
  // less/more/nl path
  if (/^(?:\/usr\/bin\/)?(?:less|more|nl)(?:\s+-[A-Za-z0-9]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'pager file',
      message: 'Use Read instead of a pager for file contents.',
    };
  }
  // wc -l path (line count only — still better as Read for agents? allow wc for process stats)
  // skip wc — useful for quick metrics
  return undefined;
}

function matchWriteLike(command: string): ShellDedicatedBypassHit | undefined {
  // echo/printf alone without redirect already allowed by hasShellComposition if redirect
  // So write-like pure forms without redirect are rare (tee?).
  // `tee path` alone reading stdin hangs — not useful.
  // `touch path` — create empty file → Write can do it
  if (/^(?:\/usr\/bin\/)?touch(?:\s+-[A-Za-z]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Write',
      pattern: 'touch file',
      message: 'Use Write to create or update files instead of touch.',
    };
  }
  return undefined;
}

function matchEditLike(command: string): ShellDedicatedBypassHit | undefined {
  // sed -i ...
  if (/^(?:\/usr\/bin\/)?sed\s+-[A-Za-z]*i[A-Za-z]*/.test(command)) {
    return {
      prefer: 'Edit',
      pattern: 'sed -i',
      message: 'Use Edit for in-place edits; it preserves exact bytes and policy checks.',
    };
  }
  // perl -pi -e
  if (/^(?:\/usr\/bin\/)?perl\s+-[A-Za-z]*p[A-Za-z]*i/.test(command)) {
    return {
      prefer: 'Edit',
      pattern: 'perl -pi',
      message: 'Use Edit for in-place text changes instead of perl -pi.',
    };
  }
  return undefined;
}

function matchGrepLike(command: string): ShellDedicatedBypassHit | undefined {
  // grep/rg/egrep/fgrep with no pipes (composition already filtered)
  if (/^(?:\/usr\/bin\/)?(?:grep|egrep|fgrep|rg)(?:\s|$)/.test(command)) {
    return {
      prefer: 'Grep',
      pattern: 'grep/rg',
      message: 'Use Grep (ripgrep-backed, workspace policy, capped output) instead of shell grep/rg.',
    };
  }
  return undefined;
}

function matchGlobLike(command: string): ShellDedicatedBypassHit | undefined {
  // find . -name '*.ts' style without pipes
  if (/^(?:\/usr\/bin\/)?find(?:\s|$)/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'find',
      message: 'Use Glob for file-name search (gitignore-aware, capped) instead of find.',
    };
  }
  // ls *.ts only — ls of a directory is often legitimate navigation; only block `ls` with glob chars?
  // Too noisy — skip bare ls.
  return undefined;
}
