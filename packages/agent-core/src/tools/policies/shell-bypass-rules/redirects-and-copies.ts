/**
 * Whole-command shell redirect / heredoc / copy idioms that write files
 * directly (no pipes, no process composition) — these map to Write/Edit.
 */

import type { ShellDedicatedBypassHit } from './types';

/**
 * Whole-command file writes via shell redirect.
 * Matches: echo/printf/cat/Write-Output/Write-Host … > path | >> path
 * Skips: pipes, &&, stderr redirects, multi-redirect, process substitution.
 */
export function matchSimpleRedirectWrite(command: string): ShellDedicatedBypassHit | undefined {
  // No pipes, lists, backticks, newlines, or process substitution.
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  // Reject stderr redirects and multi-redirect forms (2>, &>, 2>&1).
  if (/\d?>&|\d?>\s*&|2\s*>/.test(command)) return undefined;
  // Exactly one > or >> to a path (not << heredoc).
  if (command.includes('<<')) return undefined;
  // Content producers + pure identity/listing dumps redirected to a file.
  // Keep process-heavy left-hand sides (e.g. `git status > log`) allowed.
  // Optional explicit stdout fd `1` before `>` / `>>` (e.g. `echo hi 1> out.txt`).
  const m =
    /^(?:\/usr\/bin\/)?(echo|printf|cat|type|Get-Content|gc|Write-Output|Write-Host|Write-Verbose|Write-Warning|Write-Error|Write-Information|Write-Debug|pwd|hostname|whoami|date|uname|ls|dir|Get-Location|gl|Get-ChildItem|gci)\b([\s\S]*?)\s*(?:1)?(>>?)\s*(\S+)\s*$/i.exec(
      command,
    );
  if (m === null) return undefined;
  const op = m[3];
  if (op !== '>' && op !== '>>') return undefined;
  // Left side should not contain another redirect.
  const left = m[2] ?? '';
  if (/[<>]/.test(left)) return undefined;
  // Directory listings with recursive/filter work stay allowed (real shell work).
  const producer = m[1] ?? 'echo';
  if (/^(?:ls|dir|Get-ChildItem|gci)$/i.test(producer) && /(?:^|\s)-(?:R|Recurse|Force|Filter|Include|Exclude)\b/i.test(left)) {
    return undefined;
  }
  return {
    prefer: 'Write',
    pattern: `${producer} ${op} file`,
    message: 'Use Write (or Edit for patches) instead of shell redirects for file content.',
  };
}

/**
 * Empty-file creators via redirect without content producers.
 * Matches: `: > path`, `true > path`, bare `> path` / `1> path` (and `>>` / `1>>`).
 * Skips: pipes, lists, stderr redirects, heredocs, process substitution.
 */
export function matchEmptyRedirectWrite(command: string): ShellDedicatedBypassHit | undefined {
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  // Reject stderr redirects and multi-redirect forms (2>, &>, 2>&1, 1>&2).
  if (/\d?>&|\d?>\s*&|2\s*>/.test(command)) return undefined;
  if (command.includes('<<')) return undefined;
  // `: > path` / `: 1> path` / `true > path` / bare `> path` / bare `1> path`
  // Optional explicit stdout fd `1` before `>` / `>>` (common shell form).
  const m = /^(?::|true|false)?\s*(?:1)?(>>?)\s*(\S+)\s*$/.exec(command);
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

/**
 * Whole-command heredoc file writes.
 * Matches: cat/tee … > path <<EOF / cat <<EOF > path / tee path <<EOF
 * Skips: pipelines, && lists, process substitution.
 */
export function matchSimpleHeredocWrite(command: string): ShellDedicatedBypassHit | undefined {
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
  if (/^(?:\/usr\/bin\/)?(?:cat|tee)\b/.test(firstLine) && firstLine.includes('<<') && />>?/.test(firstLine)) {
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
 * Whole-command file copies that should use Write/Read instead of shell.
 * Matches: dd if=src of=dest (workspace files only), install [-m mode] src dest
 * Skips: /dev/* sources, pipelines, multi-dest install -d directories.
 */
export function matchSimpleFileCopyWrite(command: string): ShellDedicatedBypassHit | undefined {
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
      .replaceAll(/(?:^|\s)-(?:m|o|g|S|Z|C|p|v|b)(?:\s+\S+)?/g, ' ')
      .replaceAll(/(?:^|\s)--\S+/g, ' ')
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

  // cp SRC DEST — simple two-path workspace copy (not -r trees, not multi-source).
  // mv stays allowed (rename has no dedicated tool).
  if (/^(?:\/usr\/bin\/)?cp\b/.test(command)) {
    if (/(?:^|\s)-(?:[a-zA-Z]*r[a-zA-Z]*|R|a|recursive)(?:\s|$)/.test(command)) {
      return undefined;
    }
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?cp\b/, '')
      .replaceAll(/(?:^|\s)--\S+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z]+/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 2 && !args[0]!.startsWith('-') && !args[1]!.startsWith('-')) {
      return {
        prefer: 'Write',
        pattern: 'cp src dest',
        message: 'Use Read + Write instead of cp for simple workspace file copies.',
      };
    }
  }

  // Copy-Item / ci / copy SRC DEST — simple two-path (not -Recurse, not multi-source).
  if (/^(?:Copy-Item|ci|copy)\b/i.test(command)) {
    if (/(?:^|\s)-(?:Recurse|Container|Filter|Include|Exclude)\b/i.test(command)) {
      return undefined;
    }
    if (/\s\|/.test(command)) return undefined;
    const withoutOpts = command
      .replace(/^(?:Copy-Item|ci|copy)\b/i, '')
      .replaceAll(/(?:^|\s)-(?:Path|Destination|LiteralPath)\s+/gi, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z]+\b/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 2 && !args[0]!.startsWith('-') && !args[1]!.startsWith('-')) {
      return {
        prefer: 'Write',
        pattern: 'Copy-Item src dest',
        message: 'Use Read + Write instead of Copy-Item for simple workspace file copies.',
      };
    }
  }

  // rsync SRC DEST — simple two-path file copy (not recursive trees / multi-source).
  if (/^(?:\/usr\/bin\/)?rsync\b/.test(command)) {
    if (/(?:^|\s)-(?:[a-zA-Z]*r[a-zA-Z]*|R|a|recursive)(?:\s|$)/.test(command)) {
      return undefined;
    }
    if (/(?:^|\s)--(?:recursive|archive|delete|dirs)\b/.test(command)) {
      return undefined;
    }
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?rsync\b/, '')
      .replaceAll(/(?:^|\s)--\S+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z]+/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 2 && !args[0]!.startsWith('-') && !args[1]!.startsWith('-')) {
      // Remote paths (host:path) stay allowed — real network/sync work.
      if (args[0]!.includes(':') || args[1]!.includes(':')) return undefined;
      return {
        prefer: 'Write',
        pattern: 'rsync src dest',
        message: 'Use Read + Write instead of rsync for simple local file copies.',
      };
    }
  }

  return undefined;
}

export function matchWriteLike(command: string): ShellDedicatedBypassHit | undefined {
  // `touch path` — create empty file → Write can do it
  if (/^(?:\/usr\/bin\/)?touch(?:\s+-[A-Za-z]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Write',
      pattern: 'touch file',
      message: 'Use Write to create or update files instead of touch.',
    };
  }
  // bare `sponge path` (no pipe) is still a whole-file sink — prefer Write.
  // Pipelines (`cmd | sponge path`) stay allowed via hasShellComposition.
  if (/^(?:\/usr\/bin\/)?sponge(?:\s+-[A-Za-z]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Write',
      pattern: 'sponge file',
      message: 'Use Write instead of sponge for whole-file writes.',
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
        .replaceAll(/(?:^|\s)-(?:s|--size)(?:=|\s+)\S+/g, ' ')
        .replaceAll(/(?:^|\s)--size=\S+/g, ' ')
        .replaceAll(/(?:^|\s)-[A-Za-z]+/g, ' ')
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

export function matchEditLike(command: string): ShellDedicatedBypassHit | undefined {
  // sed/gsed/busybox sed -i ... (GNU/BSD in-place edits)
  if (/^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?sed)\s+-[A-Za-z]*i[A-Za-z]*/.test(command)) {
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
