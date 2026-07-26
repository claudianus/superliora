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

  // Simple echo/printf/cat redirects → Write (checked before generic composition).
  const redirectWrite = matchSimpleRedirectWrite(raw);
  if (redirectWrite !== undefined) return redirectWrite;

  // cat/tee file <<EOF heredoc writers → Write (newlines make hasShellComposition true).
  const heredocWrite = matchSimpleHeredocWrite(raw);
  if (heredocWrite !== undefined) return heredocWrite;

  // Multi-statement / pipeline / redirection chains → real shell work.
  if (hasShellComposition(raw)) return undefined;

  const readHit = matchReadLike(raw);
  if (readHit !== undefined) return readHit;

  const langReadHit = matchLanguageReadLike(raw);
  if (langReadHit !== undefined) return langReadHit;

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


/**
 * Whole-command heredoc file writes.
 * Matches: cat/tee … > path <<EOF / cat <<EOF > path / tee path <<EOF
 * Skips: pipelines, && lists, process substitution.
 */
function matchSimpleHeredocWrite(command: string): ShellDedicatedBypassHit | undefined {
  // Must include a heredoc opener.
  if (!/<<\s*[-]?\s*['"]?\w+['"]?/.test(command)) return undefined;
  // No pipes / lists / backticks / process substitution (newlines OK for body).
  if (/[|`]/.test(command.split('\n')[0] ?? '')) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  // Reject stderr multi-redirect forms in the opener line.
  const firstLine = (command.split('\n')[0] ?? '').trim();
  if (/\d?>&|2\s*>/.test(firstLine)) return undefined;

  // cat/tee with redirect-or-arg path + heredoc
  const patterns = [
    /^(?:\/usr\/bin\/)?(?:cat|tee)\b[\s\S]*?(?:>>?\s*(\S+)|\s+(\S+))\s*<<\s*[-]?\s*['"]?\w+['"]?/,
    /^(?:\/usr\/bin\/)?(?:cat|tee)\b\s*<<\s*[-]?\s*['"]?\w+['"]?\s*>>?\s*(\S+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(firstLine);
    if (m === null) continue;
    return {
      prefer: 'Write',
      pattern: 'heredoc > file',
      message: 'Use Write (or Edit for patches) instead of shell heredocs for file content.',
    };
  }
  // Multiline: first line may be `cat > out <<EOF` already covered; also `cat <<EOF > out`
  if (/^(?:\/usr\/bin\/)?(?:cat|tee)\b/.test(firstLine) && /<</.test(firstLine) && />>?/.test(firstLine)) {
    return {
      prefer: 'Write',
      pattern: 'heredoc > file',
      message: 'Use Write (or Edit for patches) instead of shell heredocs for file content.',
    };
  }
  if (/^(?:\/usr\/bin\/)?tee\b\s+\S+\s*<</.test(firstLine)) {
    return {
      prefer: 'Write',
      pattern: 'tee heredoc',
      message: 'Use Write instead of tee heredoc for file content.',
    };
  }
  return undefined;
}


/**
 * Whole-command language one-liners that only read a file.
 * Matches: python -c open('path'), node -e readFileSync('path'), etc.
 * Skips: multi-statement scripts, network I/O, writes.
 */
function matchLanguageReadLike(command: string): ShellDedicatedBypassHit | undefined {
  // Avoid multi-line scripts and shell composition (already mostly filtered).
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;

  // python/python3 -c "...open('path')..."
  if (/^(?:\/usr\/bin\/)?python3?(?:\d+(?:\.\d+)*)?\b/.test(command) && /(?:^|\s)-c(?:\s|$)/.test(command)) {
    if (/\bopen\s*\(/.test(command) || /\bPath\s*\(/.test(command) || /\bread_text\s*\(/.test(command)) {
      // Writing through python should not be forced to Read.
      if (/\bopen\s*\([^)]*['"]\s*,\s*['"][wax+]/.test(command)) return undefined;
      if (/\bwrite(?:_text|_bytes)?\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'python -c open(file)',
        message: 'Use Read or LioraRead instead of python -c open(...) for file contents.',
      };
    }
  }

  // node/nodejs -e "...readFileSync('path')..."
  if (/^(?:\/usr\/bin\/)?node(?:js)?\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/readFile(?:Sync)?\s*\(/.test(command) || /promises\.readFile\s*\(/.test(command)) {
      if (/writeFile(?:Sync)?\s*\(/.test(command) || /appendFile(?:Sync)?\s*\(/.test(command)) {
        return undefined;
      }
      return {
        prefer: 'Read',
        pattern: 'node -e readFile',
        message: 'Use Read or LioraRead instead of node -e readFile for file contents.',
      };
    }
  }

  // ruby -e "File.read('path')"
  if (/^(?:\/usr\/bin\/)?ruby\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/File\.read\s*\(/.test(command) || /IO\.read\s*\(/.test(command)) {
      if (/File\.write\s*\(/.test(command) || /IO\.write\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'ruby -e File.read',
        message: 'Use Read or LioraRead instead of ruby -e File.read for file contents.',
      };
    }
  }

  return undefined;
}

function matchWriteLike(command: string): ShellDedicatedBypassHit | undefined {
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

/**
 * Whole-command file writes via shell redirect.
 * Matches: echo/printf/cat … > path | >> path
 * Skips: pipes, &&, stderr redirects, multi-redirect, process substitution.
 */
function matchSimpleRedirectWrite(command: string): ShellDedicatedBypassHit | undefined {
  // No pipes, lists, backticks, newlines, or process substitution.
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  // Reject stderr redirects and multi-redirect forms (2>, &>, 2>&1).
  if (/\d?>&|\d?>\s*\&|2\s*>/.test(command)) return undefined;
  // Exactly one > or >> to a path (not << heredoc).
  if (/<</.test(command)) return undefined;
  const m = /^(?:\/usr\/bin\/)?(echo|printf|cat)\b([\s\S]*?)\s*(>>?)\s*(\S+)\s*$/.exec(
    command,
  );
  if (m === null) return undefined;
  const op = m[3];
  if (op !== '>' && op !== '>>') return undefined;
  // Left side should not contain another redirect.
  const left = m[2] ?? '';
  if (/[<>]/.test(left)) return undefined;
  return {
    prefer: 'Write',
    pattern: `${m[1] ?? 'echo'} ${op} file`,
    message: 'Use Write (or Edit for patches) instead of shell redirects for file content.',
  };
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
