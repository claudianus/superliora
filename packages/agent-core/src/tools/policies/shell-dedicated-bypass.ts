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

  // `: > file` / `true > file` / bare `> file` empty creators → Write
  const emptyRedirect = matchEmptyRedirectWrite(raw);
  if (emptyRedirect !== undefined) return emptyRedirect;

  // cat/tee file <<EOF heredoc writers → Write (newlines make hasShellComposition true).
  const heredocWrite = matchSimpleHeredocWrite(raw);
  if (heredocWrite !== undefined) return heredocWrite;

  // Language -c/-e/-r file reads/writes before composition (perl open uses "<"/">" etc.).
  const langWriteHit = matchLanguageWriteLike(raw);
  if (langWriteHit !== undefined) return langWriteHit;
  const langReadHit = matchLanguageReadLike(raw);
  if (langReadHit !== undefined) return langReadHit;

  // Whole-command dd/install file copies (if=/of= use "=", not shell redirects).
  const copyHit = matchSimpleFileCopyWrite(raw);
  if (copyHit !== undefined) return copyHit;

  // Multi-statement / pipeline / redirection chains → real shell work.
  if (hasShellComposition(raw)) return undefined;

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
  // skip file/stat/sha256sum/md5sum/cksum/realpath — metadata/hash, not content dumps

  // bat / tac / rev — pure file dumpers (rev is reverse-order dump, still whole-file I/O)
  if (/^(?:\/usr\/bin\/)?(?:bat|tac|rev)(?:\s+-[A-Za-z0-9]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'bat/tac/rev file',
      message: 'Use Read or LioraRead instead of bat/tac/rev for file contents.',
    };
  }

  // paste with a single path dumps file lines side-by-side / sequentially — prefer Read.
  // Multi-file paste / paste with `-` stdin stays allowed for real shell work.
  if (/^(?:\/usr\/bin\/)?paste\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?paste\b/, '')
      .replace(/(?:^|\s)-[A-Za-z0-9]+(?:\s+\S+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'paste file',
        message: 'Use Read instead of paste for single-file content dumps.',
      };
    }
  }

  // Text formatters that dump a whole file to stdout (fmt/pr/fold/expand/…)
  if (
    /^(?:\/usr\/bin\/)?(?:fmt|pr|fold|expand|unexpand|column)(?:\s+-[A-Za-z0-9=]+)*(?:\s+\S+)*\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'fmt/pr/fold file',
      message: 'Use Read or LioraRead instead of text formatters for file contents.',
    };
  }

  // sed -n print range (not -i) with a file path
  if (
    /^(?:\/usr\/bin\/)?sed\b/.test(command) &&
    /(?:^|\s)-n(?:\s|$)/.test(command) &&
    !/(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\s|$)/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'sed -n file',
      message: 'Use Read with line_offset/n_lines instead of sed -n for file windows.',
    };
  }

  // awk/gawk one-file dumpers: awk 1 file, awk '{print}' file
  if (/^(?:\/usr\/bin\/)?(?:awk|gawk|nawk)\b/.test(command) && /\s\S+\s*$/.test(command)) {
    // skip if looks like multi-file or BEGIN-heavy scripts without a path-ish token — still whole-command only
    return {
      prefer: 'Read',
      pattern: 'awk file',
      message: 'Use Read or Grep instead of awk for whole-file dumps.',
    };
  }

  // binary/text dumpers aimed at a single path
  if (
    /^(?:\/usr\/bin\/)?(?:od|hexdump|xxd|strings|base64|base32)(?:\s+-[A-Za-z0-9]+)*\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'od/hexdump/base64 file',
      message: 'Use Read for file contents instead of shell dump utilities.',
    };
  }

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
  // Avoid multi-line scripts and shell lists/pipes. Language one-liners often
  // use `;` (php/perl) and `<` as open-mode strings — those are not shell composition.
  if (/[|`\n]/.test(command)) return undefined;
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

  // php -r "file_get_contents('path')"
  if (/^(?:\/usr\/bin\/)?php\b/.test(command) && /(?:^|\s)-r(?:\s|$)/.test(command)) {
    if (/file_get_contents\s*\(/.test(command) || /fopen\s*\(/.test(command) || /readfile\s*\(/.test(command)) {
      if (/file_put_contents\s*\(/.test(command) || /fwrite\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'php -r file_get_contents',
        message: 'Use Read or LioraRead instead of php -r file_get_contents for file contents.',
      };
    }
  }

  // perl -e/-ne/-pe reading a file (open/read_file or path arg)
  if (/^(?:\/usr\/bin\/)?perl\b/.test(command)) {
    // In-place edits (`-i`, `-pi`) are Edit jobs — leave for matchEditLike.
    if (/(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\S*)?(?:\s|$)/.test(command)) {
      return undefined;
    }
    if (/(?:^|\s)-(?:e|ne|pe|n|p)(?:\s|$)/.test(command)) {
      // Write-mode open belongs to matchLanguageWriteLike / shell work, not Read.
      if (/open\s*[^;]*['"]\s*>/.test(command) || /\bprint\s+[A-Za-z_]\w*\b/.test(command) && /open\s/.test(command)) {
        /* fall through — write matcher already ran, allow or already blocked */
      } else if (
        /\bopen\b/.test(command) ||
        /read_file\s*\(/.test(command) ||
        /File::Slurp/.test(command) ||
        /Path::Tiny/.test(command)
      ) {
        return {
          prefer: 'Read',
          pattern: 'perl -e open/read',
          message: 'Use Read or LioraRead instead of perl one-liners for file contents.',
        };
      }
      // perl -ne 'print' path  (file arg, no pipe)
      if (
        /(?:^|\s)-(?:n|p|ne|pe)(?:\s|$)/.test(command) &&
        /\s\S+\s*$/.test(command) &&
        !/[|<>]/.test(command.replace(/-[a-z]+/g, ''))
      ) {
        // crude: trailing path token after -e script is hard; match `perl -ne '...' file`
        if (/\s+\S+\.[A-Za-z0-9]+\s*$/.test(command) || /\s+\.?\/?[\w./-]+\s*$/.test(command)) {
          return {
            prefer: 'Read',
            pattern: 'perl -ne file',
            message: 'Use Read or LioraRead instead of perl -ne for file contents.',
          };
        }
      }
    }
  }

  // lua -e "io.open('path'):read"
  if (/^(?:\/usr\/bin\/)?lua\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/io\.open\s*\(/.test(command) || /\bread\s*\(/.test(command)) {
      if (/:write\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'lua -e io.open',
        message: 'Use Read or LioraRead instead of lua -e io.open for file contents.',
      };
    }
  }

  return undefined;
}

/**
 * Whole-command language one-liners that only write a file.
 * Matches: python -c open('path','w').write(...), node writeFileSync, etc.
 * Skips: multi-line scripts, pipelines, network I/O.
 */
function matchLanguageWriteLike(command: string): ShellDedicatedBypassHit | undefined {
  // Backticks / newlines are shell composition. Bare `|` also appears in ruby
  // block params (`{|f| ...}`), so only reject whitespace-bounded shell pipes
  // and shell OR/AND — not single-pipe language syntax.
  if (/[`\n]/.test(command)) return undefined;
  if (/\s\|\s/.test(command) || /\|\|/.test(command) || /\b(?:&&)\b/.test(command)) return undefined;

  // python/python3 -c write
  if (/^(?:\/usr\/bin\/)?python3?(?:\d+(?:\.\d+)*)?\b/.test(command) && /(?:^|\s)-c(?:\s|$)/.test(command)) {
    if (
      /\bopen\s*\([^)]*['"]\s*,\s*['"][wax+]/.test(command) ||
      /\bwrite(?:_text|_bytes)?\s*\(/.test(command) ||
      /\bPath\s*\([^)]*\)\s*\.\s*write_text\s*\(/.test(command)
    ) {
      return {
        prefer: 'Write',
        pattern: 'python -c write(file)',
        message: 'Use Write (or Edit for patches) instead of python -c open(...).write for file content.',
      };
    }
  }

  // node -e writeFileSync / appendFileSync
  if (/^(?:\/usr\/bin\/)?node(?:js)?\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/writeFile(?:Sync)?\s*\(/.test(command) || /appendFile(?:Sync)?\s*\(/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'node -e writeFile',
        message: 'Use Write (or Edit for patches) instead of node -e writeFile for file content.',
      };
    }
  }

  // ruby -e File.write / File.open(...,'w')
  if (/^(?:\/usr\/bin\/)?ruby\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (
      /File\.write\s*\(/.test(command) ||
      /IO\.write\s*\(/.test(command) ||
      // File.open('path','w') or File.open("path", "a") — mode is the 2nd string arg
      /File\.open\s*\(\s*['"][^'"]+['"]\s*,\s*['"][wax+]/.test(command)
    ) {
      return {
        prefer: 'Write',
        pattern: 'ruby -e File.write',
        message: 'Use Write (or Edit for patches) instead of ruby -e File.write for file content.',
      };
    }
  }

  // php -r file_put_contents / fwrite
  if (/^(?:\/usr\/bin\/)?php\b/.test(command) && /(?:^|\s)-r(?:\s|$)/.test(command)) {
    if (/file_put_contents\s*\(/.test(command) || /fwrite\s*\(/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'php -r file_put_contents',
        message: 'Use Write (or Edit for patches) instead of php -r file_put_contents for file content.',
      };
    }
  }

  // perl -e open with write mode
  if (/^(?:\/usr\/bin\/)?perl\b/.test(command) && /(?:^|\s)-(?:e|ne|pe|n|p)(?:\s|$)/.test(command)) {
    if (/open\s*[^;]*['"]\s*>/.test(command) || /Path::Tiny.*spew/.test(command) || /write_file\s*\(/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'perl -e open write',
        message: 'Use Write (or Edit for patches) instead of perl one-liners for file content.',
      };
    }
  }

  // lua -e io.open(...):write
  if (/^(?:\/usr\/bin\/)?lua\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/:write\s*\(/.test(command) || /io\.open\s*\([^)]*['"][wax]/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'lua -e io.write',
        message: 'Use Write (or Edit for patches) instead of lua -e io.open write for file content.',
      };
    }
  }

  return undefined;
}

/**
 * Whole-command file copies that should use Write/Read instead of shell.
 * Matches: dd if=src of=dest (workspace files only), install [-m mode] src dest
 * Skips: /dev/* sources, pipelines, multi-dest install -d directories.
 */
function matchSimpleFileCopyWrite(command: string): ShellDedicatedBypassHit | undefined {
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[<>]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;

  // dd if=src of=dest [bs=…] [count=…] — only when both paths look like workspace files.
  if (/^(?:\/usr\/bin\/)?dd\b/.test(command)) {
    const ifMatch = /(?:^|\s)if=(\S+)/.exec(command);
    const ofMatch = /(?:^|\s)of=(\S+)/.exec(command);
    if (ifMatch && ofMatch) {
      const src = ifMatch[1] ?? '';
      const dest = ofMatch[1] ?? '';
      const isDev = (p: string) => p === '/dev/null' || p.startsWith('/dev/');
      // Real shell: zero/random fill, or device I/O.
      if (!isDev(src) && !isDev(dest) && src.length > 0 && dest.length > 0) {
        return {
          prefer: 'Write',
          pattern: 'dd if= of=',
          message: 'Use Read + Write (or a dedicated copy tool) instead of dd for workspace file copies.',
        };
      }
    }
  }

  // install [-m MODE] [-o user] [-g group] SRC DEST — single file install/copy.
  // Skip: install -d (mkdir), multi-source install, install without dest.
  if (/^(?:\/usr\/bin\/)?install\b/.test(command)) {
    if (/(?:^|\s)-d(?:\s|$)/.test(command)) return undefined;
    // Strip known option tokens, then require exactly two path args.
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?install\b/, '')
      .replace(/(?:^|\s)-(?:m|o|g|S|Z|C|p|v|b)(?:\s+\S+)?/g, ' ')
      .replace(/(?:^|\s)--\S+/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 2 && !args[0]!.startsWith('-') && !args[1]!.startsWith('-')) {
      return {
        prefer: 'Write',
        pattern: 'install src dest',
        message: 'Use Write (or a dedicated copy) instead of install for workspace file copies.',
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
  // `truncate -s 0 path` / `truncate --size=0 path` — empty a file
  // (non-zero sizes stay allowed for sparse allocate / intentional sizing).
  if (/^(?:\/usr\/bin\/)?truncate\b/.test(command)) {
    const zeroSize =
      /(?:^|\s)-(?:s|--size)(?:=|\s+)0(?:\s|$)/.test(command) ||
      /(?:^|\s)--size=0(?:\s|$)/.test(command);
    if (zeroSize) {
      const without = command
        .replace(/^(?:\/usr\/bin\/)?truncate\b/, '')
        .replace(/(?:^|\s)-(?:s|--size)(?:=|\s+)\S+/g, ' ')
        .replace(/(?:^|\s)--size=\S+/g, ' ')
        .replace(/(?:^|\s)-[A-Za-z]+/g, ' ')
        .trim();
      const args = without.split(/\s+/).filter(Boolean);
      if (args.length === 1 && !args[0]!.startsWith('-')) {
        return {
          prefer: 'Write',
          pattern: 'truncate -s 0',
          message: 'Use Write with empty content instead of truncate -s 0 to clear a file.',
        };
      }
    }
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

/**
 * Empty-file creators via redirect without content producers.
 * Matches: `: > path`, `true > path`, bare `> path` (and `>>` append-create).
 * Skips: pipes, lists, stderr redirects, heredocs, process substitution.
 */
function matchEmptyRedirectWrite(command: string): ShellDedicatedBypassHit | undefined {
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  if (/\d?>&|\d?>\s*\&|2\s*>/.test(command)) return undefined;
  if (/<</.test(command)) return undefined;
  // `: > path` / `: >> path` / `true > path` / `false > path` / bare `> path`
  const m =
    /^(?::|true|false)?\s*(>>?)\s*(\S+)\s*$/.exec(command) ??
    /^(?::|true|false)\s*(>>?)\s*(\S+)\s*$/.exec(command);
  if (m === null) return undefined;
  const op = m[1];
  const path = m[2] ?? '';
  if ((op !== '>' && op !== '>>') || path.length === 0) return undefined;
  return {
    prefer: 'Write',
    pattern: `${op} file`,
    message: 'Use Write to create or clear files instead of empty shell redirects.',
  };
}

function matchEditLike(command: string): ShellDedicatedBypassHit | undefined {
  // sed/gsed -i ... (GNU/BSD in-place edits)
  if (/^(?:\/usr\/bin\/)?(?:g?sed)\s+-[A-Za-z]*i[A-Za-z]*/.test(command)) {
    return {
      prefer: 'Edit',
      pattern: 'sed -i',
      message: 'Use Edit for in-place edits; it preserves exact bytes and policy checks.',
    };
  }
  // perl -pi / -i -pe / -i.bak -pe in-place edits
  if (
    /^(?:\/usr\/bin\/)?perl\s+-[A-Za-z]*p[A-Za-z]*i/.test(command) ||
    /^(?:\/usr\/bin\/)?perl\s+-[A-Za-z]*i[A-Za-z]*(?:\S*)?(?:\s+-[A-Za-z]*p|\s+-pe|\s+-p\b)/.test(
      command,
    )
  ) {
    return {
      prefer: 'Edit',
      pattern: 'perl -pi',
      message: 'Use Edit for in-place text changes instead of perl -pi/-i.',
    };
  }
  // ruby -i / -i.bak -pe in-place edits
  if (
    /^(?:\/usr\/bin\/)?ruby\s+-[A-Za-z]*i[A-Za-z]*(?:\S*)?(?:\s+-[A-Za-z]*p|\s+-pe|\s+-p\b|\s+-e\b)/.test(
      command,
    ) ||
    /^(?:\/usr\/bin\/)?ruby\s+-i(?:\.\S+)?(?:\s|$)/.test(command)
  ) {
    return {
      prefer: 'Edit',
      pattern: 'ruby -i',
      message: 'Use Edit for in-place text changes instead of ruby -i.',
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
