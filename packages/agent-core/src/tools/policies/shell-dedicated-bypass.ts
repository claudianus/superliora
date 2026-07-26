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

  // Strip leading process wrappers (`command`, `timeout`, `stdbuf`, …) so
  // `timeout 5 cat file` still prefers Read. Real shell composition is checked later.
  const unwrapped = stripLeadingShellUtilityWrappers(raw);

  // Simple echo/printf/cat redirects → Write (checked before generic composition).
  const redirectWrite = matchSimpleRedirectWrite(unwrapped);
  if (redirectWrite !== undefined) return redirectWrite;

  // `: > file` / `true > file` / bare `> file` empty creators → Write
  const emptyRedirect = matchEmptyRedirectWrite(unwrapped);
  if (emptyRedirect !== undefined) return emptyRedirect;

  // cat/tee file <<EOF heredoc writers → Write (newlines make hasShellComposition true).
  const heredocWrite = matchSimpleHeredocWrite(unwrapped);
  if (heredocWrite !== undefined) return heredocWrite;

  // Language -c/-e/-r file reads/writes before composition (perl open uses "<"/">" etc.).
  const langWriteHit = matchLanguageWriteLike(unwrapped);
  if (langWriteHit !== undefined) return langWriteHit;
  const langReadHit = matchLanguageReadLike(unwrapped);
  if (langReadHit !== undefined) return langReadHit;

  // Whole-command dd/install file copies (if=/of= use "=", not shell redirects).
  const copyHit = matchSimpleFileCopyWrite(unwrapped);
  if (copyHit !== undefined) return copyHit;

  // Clipboard file dumps/loads before composition so `pbcopy < file` still prefers Read/Write.
  // Pipelines like `cmd | pbcopy` stay allowed (real shell composition).
  const clipboardHit = matchClipboardFileBypass(unwrapped);
  if (clipboardHit !== undefined) return clipboardHit;

  // Pure PowerShell producer → Set-Content/Out-File/Tee-Object pipes (before composition guard).
  // Real process pipelines (`Get-Process | Set-Content …`) stay allowed.
  const psPipeWriteHit = matchPowerShellPipeWriteBypass(unwrapped);
  if (psPipeWriteHit !== undefined) return psPipeWriteHit;

  // Pure file dump → Set-Content/Out-File/tee/sponge pipes (before composition guard).
  // Real process pipelines (`Get-Process | Set-Content …`) stay allowed.
  const filePipeWriteHit = matchFileDumpPipeWriteBypass(unwrapped);
  if (filePipeWriteHit !== undefined) return filePipeWriteHit;

  // Pure Get-Content path | Format-*/Out-String dumps → Read (before composition guard).
  const psPipeReadHit = matchPowerShellPipeReadBypass(unwrapped);
  if (psPipeReadHit !== undefined) return psPipeReadHit;

  // Pure file → pager/head/tail pipes → Read (before composition guard).
  const filePagerHit = matchFilePagerPipeReadBypass(unwrapped);
  if (filePagerHit !== undefined) return filePagerHit;

  // Start-Transcript path dumps → Write (session log file I/O; Stop-Transcript stays allowed).
  const transcriptHit = matchStartTranscriptWrite(unwrapped);
  if (transcriptHit !== undefined) return transcriptHit;

  // Multi-statement / pipeline / redirection chains → real shell work.
  if (hasShellComposition(unwrapped)) return undefined;

  const readHit = matchReadLike(unwrapped);
  if (readHit !== undefined) return readHit;

  const writeHit = matchWriteLike(unwrapped);
  if (writeHit !== undefined) return writeHit;

  const editHit = matchEditLike(unwrapped);
  if (editHit !== undefined) return editHit;

  const grepHit = matchGrepLike(unwrapped);
  if (grepHit !== undefined) return grepHit;

  const globHit = matchGlobLike(unwrapped);
  if (globHit !== undefined) return globHit;

  return undefined;
}

/**
 * Peel leading no-op / process wrappers so dedicated-tool detection still fires.
 * Leaves `command -v`, `env -i`, multi-arg env assignments, etc. alone.
 */
function stripLeadingShellUtilityWrappers(command: string): string {
  let next = command.trim();
  // Leading backslash escapes alias lookup: `\cat file` → `cat file`.
  if (next.startsWith('\\') && next.length > 1 && !next.startsWith('\\\\')) {
    next = next.slice(1).trimStart();
  }
  for (let i = 0; i < 4; i += 1) {
    const before = next;
    // `command cat …` but not `command -v cat` / `command -p …`
    if (/^command(?:\s+--)?\s+(?![-\/])/.test(next)) {
      next = next.replace(/^command(?:\s+--)?\s+/, '').trimStart();
    }
    // bare `env cmd …` without KEY=val / -options
    else if (/^env\s+(?![A-Za-z_][A-Za-z0-9_]*=)(?!-)\S/.test(next)) {
      next = next.replace(/^env\s+/, '').trimStart();
    }
    // `timeout [opts] DURATION cmd` — duration is required before the utility
    else if (/^timeout\b/.test(next)) {
      const stripped = next
        .replace(/^timeout\b/, '')
        .replace(/^\s+(?:--foreground|--preserve-status|--verbose|-v)\b/g, '')
        .replace(/^\s+--signal(?:=\S+|\s+\S+)/, '')
        .replace(/^\s+-s(?:\s+\S+|=?\S+)/, '')
        .replace(/^\s+--kill-after(?:=\S+|\s+\S+)/, '')
        .replace(/^\s+-k(?:\s+\S+|=?\S+)/, '')
        .trimStart();
      // First token is duration (5, 5s, 1m, …); drop it if present.
      const m = /^(\d+(?:\.\d+)?[smhd]?)\s+(.+)$/.exec(stripped);
      if (m?.[2] !== undefined) next = m[2].trimStart();
    }
    // `stdbuf -oL cat …` / `stdbuf -i0 -o0 -e0 cat …`
    else if (/^stdbuf\b/.test(next)) {
      const stripped = next
        .replace(/^stdbuf\b/, '')
        .replace(/(?:\s+-[ioe](?:=\S+|\s+\S+))+/g, ' ')
        .replace(/(?:\s+--(?:input|output|error)-buf(?:=\S+|\s+\S+))+/g, ' ')
        .trimStart();
      if (stripped.length > 0 && stripped !== next.replace(/^stdbuf\b/, '').trimStart()) {
        next = stripped;
      } else if (/^stdbuf(?:\s+-[ioe]\S*)+\s+\S/.test(next)) {
        next = next.replace(/^stdbuf(?:\s+-[ioe]\S*)+\s+/, '').trimStart();
      }
    }
    // `nice [-n N] cmd` / bare `nice cmd`
    else if (/^nice\b/.test(next)) {
      const stripped = next
        .replace(/^nice\b/, '')
        .replace(/^\s+-n(?:\s+\S+|=?\S+)/, '')
        .replace(/^\s+--adjustment(?:=\S+|\s+\S+)/, '')
        .trimStart();
      if (stripped.length > 0) next = stripped;
    }
    // `nohup cmd`
    else if (/^nohup\s+/.test(next)) {
      next = next.replace(/^nohup\s+/, '').trimStart();
    }
    // `powershell -Command …` / `pwsh -c '…'` — unwrap one-shot script hosts so
    // dedicated-tool detection still prefers Read/Write for simple file I/O.
    // Interactive/session hosts without -Command/-c stay allowed.
    else if (/^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(next)) {
      const m =
        /^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b(?:\s+(?!(?:-Command|-c)\b)\S+)*\s+(?:-Command|-c)\s+(.+)$/i.exec(
          next,
        );
      if (m?.[1] !== undefined) {
        let inner = m[1].trim();
        if (
          (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) ||
          (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2)
        ) {
          inner = inner.slice(1, -1).trim();
        }
        if (inner.length > 0) next = inner;
      }
    }
    // `cmd /c type file` / `cmd.exe /C "Get-Content a.ts"` — unwrap one-shot cmd.
    else if (/^cmd(?:\.exe)?\s+\/[cC]\s+/.test(next)) {
      let inner = next.replace(/^cmd(?:\.exe)?\s+\/[cC]\s+/i, '').trim();
      if (
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) ||
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2)
      ) {
        inner = inner.slice(1, -1).trim();
      }
      if (inner.length > 0) next = inner;
    }
    if (next === before) break;
  }
  return next.trim();
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
  // cat [flags] path  (+ busybox/gcat/batcat aliases)
  if (
    /^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?cat|batcat)(?:\s+-[A-Za-z]+)*\s+\S+\s*$/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'cat file',
      message: 'Use Read (edit-ready bytes) or LioraRead (signatures/map/lines) instead of cat.',
    };
  }
  // Windows cmd `type file` / `type.exe file` and PowerShell Get-Content single-file dumps
  if (/^type(?:\.exe)?(?:\s+\/[A-Za-z]+)*\s+\S+\s*$/i.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'type file',
      message: 'Use Read instead of Windows `type` for file contents.',
    };
  }
  if (
    /^(?:Get-Content|gc)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /\s\S+\s*$/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'Get-Content file',
      message: 'Use Read instead of PowerShell Get-Content for file contents.',
    };
  }
  // Get-Item / gi of a single file path often used as a content/metadata dump → Read.
  // Directory navigation (`Get-Item .`) and pipelines stay allowed.
  if (
    /^(?:Get-Item|gi)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/(?:-Recurse|-Filter|-Include|-Exclude)\b/i.test(command) &&
    /(?:\.[\w]{1,8}\b|\\[\w.-]+\.[\w]{1,8}\b|\/[\w.-]+\.[\w]{1,8}\b)/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'Get-Item file',
      message: 'Use Read instead of PowerShell Get-Item for file contents/metadata dumps.',
    };
  }
  // PowerShell Set-Content / Out-File / Add-Content single-file writes → Write.
  // Pipelines and multi-object composition stay allowed.
  if (
    /^(?:Set-Content|sc|Out-File|Add-Content|ac)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:ForEach-Object|%|Where-Object)\b/i.test(command)
  ) {
    const hasPath =
      /(?:^|\s)-Path\s+\S+/i.test(command) ||
      /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
        command,
      ) ||
      /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(command);
    if (hasPath) {
      return {
        prefer: 'Write',
        pattern: 'Set-Content/Out-File',
        message: 'Use Write (or Edit for patches) instead of PowerShell Set-Content/Out-File.',
      };
    }
  }
  // Clear-Content / clc single-file clear → Write (Unix: truncate -s 0).
  if (
    /^(?:Clear-Content|clc)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:ForEach-Object|%|Where-Object)\b/i.test(command)
  ) {
    const hasPath =
      /(?:^|\s)-Path\s+\S+/i.test(command) ||
      /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
        command,
      ) ||
      /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(command);
    if (hasPath) {
      return {
        prefer: 'Write',
        pattern: 'Clear-Content',
        message: 'Use Write with empty content instead of PowerShell Clear-Content to clear a file.',
      };
    }
  }
  // Tee-Object / tee single-file write → Write (Unix: tee path).
  // Pipelines (`cmd | Tee-Object file`) stay allowed for real shell composition.
  if (
    /^(?:Tee-Object|tee)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:ForEach-Object|%|Where-Object)\b/i.test(command)
  ) {
    const hasPath =
      /(?:^|\s)-(?:FilePath|Path|LiteralPath)\s+\S+/i.test(command) ||
      /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
        command,
      ) ||
      /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(command);
    if (hasPath) {
      return {
        prefer: 'Write',
        pattern: 'Tee-Object file',
        message: 'Use Write (or Edit for patches) instead of PowerShell Tee-Object for file content.',
      };
    }
  }
  // Write-Output / Write-Host → Set-Content / Out-File / Add-Content / Tee-Object
  // (plain `> path` is handled by matchSimpleRedirectWrite).
  if (/^(?:Write-Output|Write-Host)\b/i.test(command)) {
    if (
      /\b(?:Set-Content|Out-File|Add-Content|sc|ac|Tee-Object|tee)\b/i.test(command) ||
      /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(command)
    ) {
      return {
        prefer: 'Write',
        pattern: 'Write-Output/Write-Host file',
        message: 'Use Write instead of PowerShell Write-Output/Write-Host for file dumps.',
      };
    }
  }
  // New-Item -ItemType File / ni … File / bare New-Item path.ext → Write (Unix: touch).
  // Directory creates and recursive/filter work stay allowed.
  if (
    /^(?:New-Item|ni)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/(?:-ItemType|-Type)\s+Directory\b/i.test(command) &&
    !/\b(?:-Recurse|-Force)\b/i.test(command)
  ) {
    const isFileType = /(?:-ItemType|-Type)\s+File\b/i.test(command);
    const hasPathExt =
      /(?:^|\s)-(?:Path|LiteralPath|Name)\s+\S+\.\w{1,8}\b/i.test(command) ||
      /(?:^|\s)(?:\.\/|\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
        command,
      ) ||
      /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(command);
    if (isFileType || hasPathExt) {
      return {
        prefer: 'Write',
        pattern: 'New-Item File',
        message: 'Use Write to create empty/new files instead of PowerShell New-Item.',
      };
    }
  }
  // head/tail [flags] path — not head of a pipeline (+ busybox/ghead/gtail)
  // Flags may take a following value token: head -n 20 file, tail -50 file, head -n20 file
  if (
    /^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?head|g?tail)(?:\s+-[A-Za-z0-9]+(?:\s+\d+)?)*(?:\s+\S+)\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'head/tail file',
      message: 'Use Read with line_offset/n_lines (or LioraRead mode=lines) instead of head/tail.',
    };
  }
  // less/more/most/nl path — pure pagers dumping a single file.
  if (/^(?:\/usr\/bin\/)?(?:less|more|most|nl)(?:\s+-[A-Za-z0-9]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'pager file',
      message: 'Use Read instead of a pager for file contents.',
    };
  }
  // w3m/lynx/elinks file dumps (local path only; URLs stay allowed for real browsing).
  if (
    /^(?:\/usr\/bin\/)?(?:w3m|lynx|elinks)(?:\s+-[A-Za-z0-9=]+)*\s+(?!https?:\/\/)\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'text-browser file',
      message: 'Use Read instead of w3m/lynx/elinks for local file contents.',
    };
  }
  // zcat/gzcat/bzcat/xzcat — decompress-to-stdout of a single archive/path.
  // Pipelines (zcat f | head) stay allowed for real shell composition.
  if (
    /^(?:\/usr\/bin\/)?(?:zcat|gzcat|bzcat|xzcat|lzcat|zstdcat)(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'zcat file',
      message: 'Use Read (or a dedicated archive tool) instead of zcat/gzcat for file contents.',
    };
  }
  // wc -l path (line count only — still better as Read for agents? allow wc for process stats)
  // skip wc — useful for quick metrics
  // skip file/stat/wc/realpath — pure metadata/metrics (hash dumps handled below as Read)

  // bat / batcat / tac / rev / pygmentize / highlight — pure file dumpers
  if (
    /^(?:\/usr\/bin\/)?(?:bat|batcat|tac|rev|pygmentize)(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'bat/tac/rev file',
      message: 'Use Read or LioraRead instead of bat/tac/rev for file contents.',
    };
  }
  // highlight / source-highlight whole-file pretty dumps to stdout
  if (
    /^(?:\/usr\/bin\/)?(?:highlight|source-highlight)(?:\s+-[A-Za-z0-9=]+)*(?:\s+-i\s+\S+|\s+\S+)\s*$/.test(
      command,
    ) &&
    !/\s-o\s+(?!\/dev\/stdout)\S+/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'highlight file',
      message: 'Use Read instead of highlight/source-highlight for file contents.',
    };
  }
  // glow / mdcat / rich — markdown/pretty file viewers that dump whole files.
  // Multi-path or piped forms stay allowed for real shell composition.
  if (
    /^(?:\/usr\/bin\/)?(?:glow|mdcat)(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'glow/mdcat file',
      message: 'Use Read instead of glow/mdcat for file contents.',
    };
  }
  // `rich file.py` / `python -m rich.syntax file.py` pretty-print dumps.
  if (
    /^(?:\/usr\/bin\/)?rich(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(command) ||
    /^(?:\/usr\/bin\/)?python(?:3(?:\.\d+)?)?\s+-m\s+rich(?:\.syntax)?(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'rich file',
      message: 'Use Read instead of rich for file contents.',
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

  // sort/uniq/shuf single-file dumps — multi-file sort/merge and stdin stay allowed.
  if (/^(?:\/usr\/bin\/)?(?:sort|uniq|shuf|gsort)\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?(?:sort|uniq|shuf|gsort)\b/, '')
      .replace(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replace(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'sort/uniq/shuf file',
        message: 'Use Read instead of sort/uniq/shuf for single-file content dumps.',
      };
    }
  }

  // look WORD FILE — binary-search dump of a sorted dictionary file.
  // `look word` (system dict, no path) stays allowed.
  if (/^(?:\/usr\/bin\/)?look\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?look\b/, '')
      .replace(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replace(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 2 && args.every((a) => a !== '-' && !a.startsWith('-'))) {
      return {
        prefer: 'Grep',
        pattern: 'look word file',
        message: 'Use Grep (or Read) instead of look for dictionary/file searches.',
      };
    }
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
  // iconv whole-file re-encode dumps: iconv -f enc -t enc file
  // stdin forms (`iconv -f … -t …` with no path / `-`) stay allowed.
  // Options take values (`-f utf-8`), so strip flag+value pairs before counting paths.
  if (/^(?:\/usr\/bin\/)?iconv\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?iconv\b/, '')
      .replace(/(?:^|\s)-(?:f|t|c|o|l|s)\s+\S+/g, ' ')
      .replace(/(?:^|\s)--(?:from-code|to-code)=[^\s]+/g, ' ')
      .replace(/(?:^|\s)--(?:from-code|to-code)\s+\S+/g, ' ')
      .replace(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replace(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'iconv file',
        message: 'Use Read instead of iconv for whole-file content dumps.',
      };
    }
  }

  // jq/yq whole-file pretty-print / dump (no pipeline, single path arg)
  if (
    /^(?:\/usr\/bin\/)?(?:jq|yq)(?:\s+-[A-Za-z0-9=]+)*(?:\s+['"]?\.[A-Za-z0-9_.\[\]'"]*)?\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'jq/yq file',
      message: 'Use Read instead of jq/yq for whole-file JSON/YAML dumps.',
    };
  }

  // python -m json.tool path  (pretty-print dump of a JSON file)
  if (
    /^(?:\/usr\/bin\/)?python(?:3(?:\.\d+)?)?\s+-m\s+json\.tool(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'python -m json.tool file',
      message: 'Use Read instead of python -m json.tool for JSON file dumps.',
    };
  }

  // VCS single-path content dumps: prefer Read for workspace files.
  // Keep `git show HEAD`, `git show --stat`, blame, and multi-file log allowed.
  if (/^(?:\/usr\/bin\/)?git\s+show\b/.test(command)) {
    // `git show <rev>:<path>` or `git show :<path>` — blob dump of a tracked path.
    if (/(?:^|\s)(?:[^\s:]+:)?(?:\.?\/)?[\w./@+-]+\.[A-Za-z0-9]+\s*$/.test(command) &&
      /:[^\s]+/.test(command) &&
      !/(?:^|\s)--(?:stat|name-only|name-status|oneline|pretty|format=)/.test(command)
    ) {
      return {
        prefer: 'Read',
        pattern: 'git show path',
        message:
          'Use Read for workspace file contents. Prefer `git show --stat` for commit summaries.',
      };
    }
  }
  if (
    /^(?:\/usr\/bin\/)?git\s+cat-file\s+-p\s+\S+:\S+\s*$/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'git cat-file -p path',
      message: 'Use Read for workspace file contents instead of git cat-file -p <rev>:<path>.',
    };
  }
  // svn/hg cat path
  if (/^(?:\/usr\/bin\/)?(?:svn|hg)\s+cat(?:\s+-[A-Za-z0-9=]+)*\s+\S+\s*$/.test(command)) {
    return {
      prefer: 'Read',
      pattern: 'svn/hg cat file',
      message: 'Use Read instead of svn/hg cat for file contents.',
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

  // lua -e io.open(...):write  (require explicit write-mode open or :write call)
  if (/^(?:\/usr\/bin\/)?lua\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    const hasWriteCall = /:write\s*\(/.test(command);
    // Match io.open('path','w') / io.open("path", "a+") — not bare io.open('path'):read('*a')
    const hasWriteModeOpen =
      /io\.open\s*\(\s*['"][^'"]+['"]\s*,\s*['"][wax+]/.test(command);
    if (hasWriteCall || hasWriteModeOpen) {
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
 * Pure PowerShell value producers piped into file writers.
 * Matches:
 *   - Write-Output/Write-Host/echo … | Set-Content/Out-File/Add-Content/Tee-Object/sponge path
 *   - 'literal' / "literal" | Set-Content path
 *   - $null / numeric / range constants | Set-Content path
 * Skips: real process left-hand sides, multi-pipe chains, &&/|| lists.
 */
function matchPowerShellPipeWriteBypass(command: string): ShellDedicatedBypassHit | undefined {
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[;&`]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  // Exactly one pipe — multi-stage pipelines stay allowed.
  if ((command.match(/\|/g) ?? []).length !== 1) return undefined;

  const producerCmdRe =
    'Write-Output|Write-Host|Write-Verbose|Write-Warning|Write-Error|Write-Information|Write-Debug|echo|printf';
  const sinkRe = 'Set-Content|Out-File|Add-Content|sc|ac|Tee-Object|tee|sponge';
  // PowerShell here-string first: body may contain newlines (`@'…'@` / `@"…"@`).
  const hereStringMatch = new RegExp(
    `^(@(['"])[\\s\\S]*?\\2@)\\s*\\|\\s*(${sinkRe})\\b([\\s\\S]*)$`,
    'i',
  ).exec(command);
  // Non-here-string producers still reject raw newlines (statement separators).
  if (hereStringMatch === null && /\n/.test(command)) return undefined;
  const m =
    hereStringMatch ??
    new RegExp(
      `^(${producerCmdRe})\\b([\\s\\S]*?)\\s*\\|\\s*(${sinkRe})\\b([\\s\\S]*)$`,
      'i',
    ).exec(command) ??
    new RegExp(
      `^(['"])([\\s\\S]*?)\\1\\s*\\|\\s*(${sinkRe})\\b([\\s\\S]*)$`,
      'i',
    ).exec(command) ??
    // Constant producers: $null, 0, 1.5, 1..3
    new RegExp(
      `^(\\$null|-?\\d+(?:\\.\\d+)?|-?\\d+\\.\\.-?\\d+)\\s*\\|\\s*(${sinkRe})\\b([\\s\\S]*)$`,
      'i',
    ).exec(command);
  if (m === null) return undefined;

  // Groups differ:
  // - command form: producer, middle, sink, sinkArgs (length 5)
  // - string form: quote, body, sink, sinkArgs (length 5, producer is quote char)
  // - here-string form: fullHere, quote, sink, sinkArgs (length 5)
  // - constant form: producer, sink, sinkArgs (length 4)
  const isConstant =
    m.length === 4 &&
    !/^['"]/.test(m[1] ?? '') &&
    !/^@/.test(m[1] ?? '') &&
    !/^(?:Write-|echo|printf)/i.test(m[1] ?? '');
  const isHereString = typeof m[1] === 'string' && m[1].startsWith('@');
  const sink = (isConstant ? m[2] : m[3]) ?? 'Set-Content';
  const sinkArgs = (isConstant ? m[3] : m[4]) ?? '';
  // Require a path-like sink argument so bare `Write-Output x | Set-Content` stays allowed.
  const hasPath =
    /(?:^|\s)-(?:Path|LiteralPath|FilePath)\s+\S+/i.test(sinkArgs) ||
    /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
      sinkArgs,
    ) ||
    /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(sinkArgs);
  if (!hasPath) return undefined;

  const producerRaw = m[1] ?? 'literal';
  let producer: string;
  if (/^(?:Write-(?:Output|Host|Verbose|Warning|Error|Information|Debug)|echo|printf)$/i.test(producerRaw)) {
    producer = producerRaw;
  } else if (isHereString) {
    producer = 'here-string';
  } else if (/^\$null$/i.test(producerRaw) || /^-?\d/.test(producerRaw)) {
    producer = 'constant';
  } else {
    producer = 'literal';
  }
  return {
    prefer: 'Write',
    pattern: `${producer} | ${sink}`,
    message:
      'Use Write instead of PowerShell/stream producers (or string/constant/here-string) piped into Set-Content/Out-File/Tee-Object/sponge.',
  };
}

/**
 * Pure file dumps piped into write sinks → Write.
 * Matches: cat/bat/glow/head/base64/jq/yq/json.tool/type/Get-Content path | Set-Content/Out-File/tee/sponge path
 * Skips: multi-pipe, process producers, path-less sinks, stderr multi-redirects.
 */
function matchFileDumpPipeWriteBypass(command: string): ShellDedicatedBypassHit | undefined {
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[;&`\n]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  if ((command.match(/\|/g) ?? []).length !== 1) return undefined;

  const producerRe =
    '(?:\\/usr\\/bin\\/)?(?:busybox\\s+)?(?:g?cat|bat|batcat|tac|rev|pygmentize|glow|mdcat|rich|g?head|g?tail|nl|less|more|most|base64|hexdump|od|xxd|strings|type(?:\\.exe)?|Get-Content|gc|jq|yq|python(?:3)?\\s+-m\\s+(?:rich\\.syntax|json\\.tool))';
  const sinkRe = 'Set-Content|Out-File|Add-Content|sc|ac|Tee-Object|tee|sponge';
  const m = new RegExp(
    `^(${producerRe})\\b([\\s\\S]*?)\\s*\\|\\s*(${sinkRe})\\b([\\s\\S]*)$`,
    'i',
  ).exec(command);
  if (m === null) return undefined;

  const producer = m[1] ?? 'cat';
  const producerArgs = m[2] ?? '';
  const sink = m[3] ?? 'Set-Content';
  const sinkArgs = m[4] ?? '';

  // Producer must look like a single-path dump (not recursive/filter listing work).
  if (/(?:^|\s)-(?:Recurse|Filter|Include|Exclude|Directory)\b/i.test(producerArgs)) {
    return undefined;
  }
  const producerHasPath =
    /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(producerArgs) ||
    /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
      producerArgs,
    ) ||
    /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(producerArgs);
  if (!producerHasPath) return undefined;

  const sinkHasPath =
    /(?:^|\s)-(?:Path|LiteralPath|FilePath)\s+\S+/i.test(sinkArgs) ||
    /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
      sinkArgs,
    ) ||
    /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(sinkArgs);
  if (!sinkHasPath) return undefined;

  return {
    prefer: 'Write',
    pattern: `${producer} | ${sink}`,
    message:
      'Use Write (or Edit for patches) instead of piping file dumps into Set-Content/Out-File/tee/sponge.',
  };
}

/**
 * Pure file path dumps piped into pagers/head/tail -> Read.
 * Matches: cat/gcat/type/Get-Content/gc path | less|more|most|head|tail|nl
 * Skips: multi-pipe, non-file left-hand sides, path-less producers.
 */
function matchFilePagerPipeReadBypass(command: string): ShellDedicatedBypassHit | undefined {
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[;&`\n]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  if ((command.match(/\|/g) ?? []).length !== 1) return undefined;

  const m =
    /^(?:\/usr\/bin\/)?(cat|gcat|type|Get-Content|gc)\b([\s\S]*?)\s*\|\s*(?:\/usr\/bin\/)?(less|more|most|head|ghead|tail|gtail|nl)\b([\s\S]*)$/i.exec(
      command,
    );
  if (m === null) return undefined;

  const leftArgs = m[2] ?? '';
  const hasPath =
    /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(leftArgs) ||
    /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
      leftArgs,
    ) ||
    /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(leftArgs);
  if (!hasPath) return undefined;

  const producer = m[1] ?? 'cat';
  const pager = m[3] ?? 'less';
  return {
    prefer: 'Read',
    pattern: `${producer} | ${pager}`,
    message: 'Use Read instead of piping a file into less/more/head/tail for content dumps.',
  };
}

/**
 * Pure Get-Content path dumps piped into formatters/viewers/parsers -> Read.
 * Matches: Get-Content/gc/type path | Format-*|Out-String|Format-Hex|Out-GridView|
 * Select-Object|Select-Xml|ConvertTo-Json|ConvertFrom-Json|Import-Csv|Import-Clixml
 * Skips: multi-pipe, real process left-hand sides, path-less Get-Content.
 */
function matchPowerShellPipeReadBypass(command: string): ShellDedicatedBypassHit | undefined {
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[;&`\n]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  if ((command.match(/\|/g) ?? []).length !== 1) return undefined;

  // Longer/more-specific cmdlets first so `select` does not steal Select-Xml.
  const producerRe = 'Get-Content|gc|type|Get-Item|gi|Get-FileHash|Get-ChildItem|gci|ls|dir';
  const sinkRe = [
    'Format-List',
    'Format-Table',
    'Format-Wide',
    'Format-Custom',
    'Out-String',
    'Out-Host',
    'Out-Default',
    'Out-Null',
    'Out-Printer',
    'Format-Hex',
    'fhx',
    'Out-GridView',
    'ogv',
    'Select-Object',
    'Select-Xml',
    'ConvertTo-Json',
    'ConvertFrom-Json',
    'ConvertTo-Csv',
    'ConvertFrom-Csv',
    'ConvertTo-Html',
    'ConvertTo-Xml',
    'Import-Csv',
    'ipcsv',
    'Import-Clixml',
    'select',
    'fl',
    'ft',
    'fw',
  ].join('|');
  const m = new RegExp(
    `^(${producerRe})\\b([\\s\\S]*?)\\s*\\|\\s*(${sinkRe})\\b([\\s\\S]*)$`,
    'i',
  ).exec(command);
  if (m === null) return undefined;

  const leftArgs = m[2] ?? '';
  const hasPath =
    /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(leftArgs) ||
    /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
      leftArgs,
    ) ||
    /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(leftArgs);
  if (!hasPath) return undefined;

  const producer = m[1] ?? 'Get-Content';
  const formatter = m[3] ?? 'Format-List';
  return {
    prefer: 'Read',
    pattern: `${producer} | ${formatter}`,
    message:
      'Use Read instead of PowerShell Get-Content/Get-Item/Get-FileHash piped into Format-*/Out-String/Out-Host/Out-Null/Out-Printer/Select-Object/Convert*/Import-* for file dumps.',
  };
}

/**
 * PowerShell Start-Transcript path dumps → Write.
 * Matches: Start-Transcript -Path/-LiteralPath file, Start-Transcript file.ext
 * Skips: Stop-Transcript, pipelines, path-less Start-Transcript (console default).
 */
function matchStartTranscriptWrite(command: string): ShellDedicatedBypassHit | undefined {
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  if (!/^(?:Start-Transcript)\b/i.test(command)) return undefined;

  const hasPath =
    /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(command) ||
    /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
      command,
    ) ||
    /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(command);
  if (!hasPath) return undefined;

  return {
    prefer: 'Write',
    pattern: 'Start-Transcript path',
    message: 'Use Write instead of PowerShell Start-Transcript for file dumps.',
  };
}

/**
 * Clipboard utilities used as file dump/load shims.
 * Matches:
 *   - pbcopy < path / pbpaste > path
 *   - xclip / xsel / wl-copy with a single path arg
 * Skips: bare pbcopy (stdin from pipeline), multi-arg real shell work.
 */
function matchClipboardFileBypass(command: string): ShellDedicatedBypassHit | undefined {
  // PowerShell clipboard file I/O first — idiomatic forms often use pipelines
  // (`Get-Clipboard | Set-Content out.txt`) which the composition guard would skip.
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/[;&`\n]/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;

  // Exactly one pipe for pure file <-> clipboard shims.
  if ((command.match(/\|/g) ?? []).length === 1) {
    // Get-Content/cat/type path | Set-Clipboard/pbcopy/wl-copy/clip → Read
    const fileToClip =
      /^(Get-Content|gc|type|cat|gcat)\b([\s\S]*?)\s*\|\s*(Set-Clipboard|scb|pbcopy|wl-copy|clip)\b([\s\S]*)$/i.exec(
        command,
      );
    if (fileToClip !== null) {
      const leftArgs = fileToClip[2] ?? '';
      const hasPath =
        /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(leftArgs) ||
        /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
          leftArgs,
        ) ||
        /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(leftArgs);
      if (hasPath) {
        return {
          prefer: 'Read',
          pattern: `${fileToClip[1] ?? 'Get-Content'} | clipboard`,
          message: 'Use Read instead of piping a file into the clipboard utility.',
        };
      }
    }

    // pbpaste/Get-Clipboard | Set-Content/Out-File path → Write
    const clipToFile =
      /^(pbpaste|wl-paste|Get-Clipboard|gcb)\b([\s\S]*?)\s*\|\s*(Set-Content|Out-File|Add-Content|sc|ac|Tee-Object|tee)\b([\s\S]*)$/i.exec(
        command,
      );
    if (clipToFile !== null) {
      const sinkArgs = clipToFile[4] ?? '';
      const hasPath =
        /(?:^|\s)-(?:Path|LiteralPath|FilePath)\s+\S+/i.test(sinkArgs) ||
        /(?:^|\s)(?:\.\/|\.\.\\|[A-Za-z]:\\|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/i.test(
          sinkArgs,
        ) ||
        /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/i.test(sinkArgs);
      if (hasPath) {
        return {
          prefer: 'Write',
          pattern: `${clipToFile[1] ?? 'clipboard'} | ${clipToFile[3] ?? 'Set-Content'}`,
          message: 'Use Write instead of dumping the clipboard into a file.',
        };
      }
    }
  }

  if (/^(?:Set-Clipboard|scb)\b/i.test(command)) {
    // Set-Clipboard -Path / -Value (Get-Content file) / < file
    if (
      /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(command) ||
      /(?:^|\s)<\s*\S+\s*$/.test(command) ||
      /\(\s*(?:Get-Content|gc)\b/i.test(command)
    ) {
      return {
        prefer: 'Read',
        pattern: 'Set-Clipboard file',
        message: 'Use Read instead of PowerShell Set-Clipboard for file contents.',
      };
    }
  }
  if (/^(?:Get-Clipboard|gcb)\b/i.test(command)) {
    // Get-Clipboard | Set-Content / Out-File / Tee-Object / > path
    if (
      /(?:^|\s)>\s*\S+\s*$/.test(command) ||
      /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(command) ||
      /\b(?:Set-Content|Out-File|Add-Content|sc|ac|Tee-Object|tee)\b/i.test(command)
    ) {
      return {
        prefer: 'Write',
        pattern: 'Get-Clipboard file',
        message: 'Use Write instead of PowerShell Get-Clipboard for file dumps.',
      };
    }
  }

  if (/[|]/.test(command)) return undefined;

  // Input redirect into clipboard: pbcopy < file, wl-copy < file
  if (
    /^(?:\/usr\/bin\/)?(?:pbcopy|wl-copy|xclip|xsel)(?:\s+-[A-Za-z0-9=]+)*(?:\s+--?\S+)*\s*<\s*\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'clipboard < file',
      message: 'Use Read instead of piping a file into the clipboard utility.',
    };
  }

  // Output redirect from clipboard: pbpaste > file, xclip -o > file
  if (
    /^(?:\/usr\/bin\/)?(?:pbpaste|wl-paste)(?:\s+-[A-Za-z0-9=]+)*\s*>\s*\S+\s*$/.test(command) ||
    /^(?:\/usr\/bin\/)?xclip(?:\s+-[A-Za-z0-9=]+)*\s+-o(?:\s+-[A-Za-z0-9=]+)*\s*>\s*\S+\s*$/.test(
      command,
    ) ||
    /^(?:\/usr\/bin\/)?xsel(?:\s+-[A-Za-z0-9=]+)*\s+--output(?:\s+-[A-Za-z0-9=]+)*\s*>\s*\S+\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Write',
      pattern: 'clipboard > file',
      message: 'Use Write instead of dumping the clipboard into a file.',
    };
  }

  // xclip/xsel with a trailing path (reads file into selection without redirect).
  if (/^(?:\/usr\/bin\/)?(?:xclip|xsel)\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?(?:xclip|xsel)\b/, '')
      .replace(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replace(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'xclip/xsel file',
        message: 'Use Read instead of xclip/xsel for file contents.',
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

  // cp SRC DEST — simple two-path workspace copy (not -r trees, not multi-source).
  // mv stays allowed (rename has no dedicated tool).
  if (/^(?:\/usr\/bin\/)?cp\b/.test(command)) {
    if (/(?:^|\s)-(?:[a-zA-Z]*r[a-zA-Z]*|R|a|recursive)(?:\s|$)/.test(command)) {
      return undefined;
    }
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?cp\b/, '')
      .replace(/(?:^|\s)--\S+/g, ' ')
      .replace(/(?:^|\s)-[A-Za-z]+/g, ' ')
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
      .replace(/(?:^|\s)-(?:Path|Destination|LiteralPath)\s+/gi, ' ')
      .replace(/(?:^|\s)-[A-Za-z]+\b/g, ' ')
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
      .replace(/(?:^|\s)--\S+/g, ' ')
      .replace(/(?:^|\s)-[A-Za-z]+/g, ' ')
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

function matchWriteLike(command: string): ShellDedicatedBypassHit | undefined {
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
 * Matches: echo/printf/cat/Write-Output/Write-Host … > path | >> path
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
function matchEmptyRedirectWrite(command: string): ShellDedicatedBypassHit | undefined {
  if (/[|;&`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;
  if (/\$\(|\$\{/.test(command)) return undefined;
  // Reject stderr redirects and multi-redirect forms (2>, &>, 2>&1, 1>&2).
  if (/\d?>&|\d?>\s*\&|2\s*>/.test(command)) return undefined;
  if (/<</.test(command)) return undefined;
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

function matchEditLike(command: string): ShellDedicatedBypassHit | undefined {
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

function matchGrepLike(command: string): ShellDedicatedBypassHit | undefined {
  // grep/rg/egrep/fgrep with no pipes (composition already filtered).
  // `rg --files` is a lister → handled by matchGlobLike (called after this).
  // Still route it away from Grep here so Glob can claim it.
  if (
    /^(?:\/usr\/bin\/)?rg\b/.test(command) &&
    /(?:^|\s)--files(?:\s|$)/.test(command)
  ) {
    return undefined;
  }
  if (/^(?:\/usr\/bin\/)?(?:grep|egrep|fgrep|rg)(?:\s|$)/.test(command)) {
    return {
      prefer: 'Grep',
      pattern: 'grep/rg',
      message: 'Use Grep (ripgrep-backed, workspace policy, capped output) instead of shell grep/rg.',
    };
  }
  // Silver Searcher / ack / ugrep content search → Grep.
  if (/^(?:\/usr\/bin\/)?(?:ag|ack|ugrep|ug)(?:\s|$)/.test(command)) {
    return {
      prefer: 'Grep',
      pattern: 'ag/ack/ugrep',
      message: 'Use Grep instead of ag/ack/ugrep for workspace content search.',
    };
  }
  // `git grep` content search — prefer Grep (workspace-scoped, capped).
  // Pipelines / multi-rev composition already short-circuit.
  if (/^(?:\/usr\/bin\/)?git\s+grep\b/.test(command)) {
    return {
      prefer: 'Grep',
      pattern: 'git grep',
      message: 'Use Grep instead of git grep for workspace content search.',
    };
  }
  // Windows: Select-String / findstr whole-command searches → Grep.
  // Pipelines already short-circuit via hasShellComposition.
  if (/^(?:Select-String|sls)\b/i.test(command)) {
    return {
      prefer: 'Grep',
      pattern: 'Select-String',
      message: 'Use Grep instead of PowerShell Select-String for workspace search.',
    };
  }
  if (/^findstr(?:\.exe)?\b/i.test(command)) {
    return {
      prefer: 'Grep',
      pattern: 'findstr',
      message: 'Use Grep instead of Windows findstr for workspace search.',
    };
  }
  // PowerShell Format-* / Out-String whole dumps of Get-Content/Get-ChildItem results.
  // Pipelines stay allowed; only simple Format-* on a path-like arg is rejected.
  if (
    /^(?:Format-List|Format-Table|Format-Wide|Format-Custom|Out-String)\b/i.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bFile\b)/i.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'Format-*/Out-String',
      message: 'Use Read instead of PowerShell Format-*/Out-String for file contents.',
    };
  }
  // Format-Hex / Get-FileHash / Select-Xml path dumps → Read (pipelines stay allowed).
  if (
    /^(?:Format-Hex|fhx|Get-FileHash|Select-Xml)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b|\bGet-Content\b|\bgc\b)/i.test(command)
  ) {
    const pattern = /^(?:Format-Hex|fhx)\b/i.test(command)
      ? 'Format-Hex'
      : /^(?:Get-FileHash)\b/i.test(command)
        ? 'Get-FileHash'
        : 'Select-Xml';
    return {
      prefer: 'Read',
      pattern,
      message: `Use Read instead of PowerShell ${pattern} for file content dumps.`,
    };
  }
  // Windows certutil -hashfile single-path dumps → Read (real multi-arg work stays allowed).
  if (
    /^(?:certutil)(?:\.exe)?\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /\s-hashfile\s+\S+/i.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'certutil -hashfile',
      message: 'Use Read (or a dedicated hash tool via package scripts) instead of certutil -hashfile for file dumps.',
    };
  }
  // Unix hash dumps of a single path → Read (parity with Get-FileHash / certutil).
  // Skips: multi-file args, pipelines, recursive dir walks, openssl without a path.
  if (
    /^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:md5sum|sha1sum|sha224sum|sha256sum|sha384sum|sha512sum|shasum|cksum)\b/.test(
      command,
    ) &&
    !/\s\|/.test(command) &&
    // `-c` / `--check` verify mode stays allowed (not a pure single-file dump).
    !/(?:^|\s)(?:-c|--check)(?:\s|=|$)/.test(command)
  ) {
    // Require a path-like argument; bare `md5sum` (stdin) stays allowed.
    const hasPath =
      /(?:\.\/|\.\.\/|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/.test(command) ||
      /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/.test(command);
    if (hasPath) {
      return {
        prefer: 'Read',
        pattern: 'unix hash file',
        message:
          'Use Read (or package-script hash tooling) instead of md5sum/sha*sum/cksum for single-file dumps.',
      };
    }
  }
  if (
    /^(?:\/usr\/bin\/)?openssl\s+dgst\b/.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:-verify|-prverify|-sign)\b/.test(command)
  ) {
    const hasPath =
      /(?:\.\/|\.\.\/|\/|[\w.-]+\/|[\w.-]+\\)[\w./\\-]+\.\w{1,8}\b/.test(command) ||
      /(?:^|\s)[\w.-]+\.\w{1,8}(?:\s|$)/.test(command);
    if (hasPath) {
      return {
        prefer: 'Read',
        pattern: 'openssl dgst file',
        message: 'Use Read (or package-script hash tooling) instead of openssl dgst for single-file dumps.',
      };
    }
  }
  // ConvertTo-Html path dumps → Read/Write (pipelines stay allowed).
  // -Path/-LiteralPath without -Fragment typically writes an HTML file → Write.
  // Path dumps without write flags still prefer Read for whole-command content dumps.
  if (
    /^(?:ConvertTo-Html)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:ForEach-Object|%|Where-Object)\b/i.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b)/i.test(command)
  ) {
    const writesFile =
      /(?:^|\s)-(?:Path|LiteralPath)\s+\S+/i.test(command) || /(?:^|\s)>\s*\S+\s*$/.test(command);
    return {
      prefer: writesFile ? 'Write' : 'Read',
      pattern: 'ConvertTo-Html',
      message: writesFile
        ? 'Use Write instead of PowerShell ConvertTo-Html for file dumps.'
        : 'Use Read instead of PowerShell ConvertTo-Html for file content dumps.',
    };
  }
  // Out-GridView path dumps → Read (pipelines stay allowed for real composition).
  if (
    /^(?:Out-GridView|ogv)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b|\bGet-Content\b|\bgc\b)/i.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'Out-GridView',
      message: 'Use Read instead of PowerShell Out-GridView for file content dumps.',
    };
  }
  // ConvertTo-Json / ConvertFrom-Json of a single file path / Get-Content dump → Read
  // (pipelines stay allowed for real shell composition).
  if (
    /^(?:ConvertTo-Json|ConvertFrom-Json)\b/i.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bGet-Content\b|\bFile\b|\bLiteralPath\b)/i.test(command) &&
    !/\s\|/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: /^(?:ConvertFrom-Json)\b/i.test(command) ? 'ConvertFrom-Json' : 'ConvertTo-Json',
      message: /^(?:ConvertFrom-Json)\b/i.test(command)
        ? 'Use Read instead of ConvertFrom-Json for file content dumps.'
        : 'Use Read instead of ConvertTo-Json for file content dumps.',
    };
  }
  // Import-Csv / ConvertFrom-Csv path dumps → Read (pipelines stay allowed).
  if (
    /^(?:Import-Csv|ipcsv|ConvertFrom-Csv)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b|\bGet-Content\b|\bgc\b)/i.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: /^(?:ConvertFrom-Csv)\b/i.test(command) ? 'ConvertFrom-Csv' : 'Import-Csv',
      message: 'Use Read instead of PowerShell Import-Csv/ConvertFrom-Csv for file content dumps.',
    };
  }
  // Export-Csv / ConvertTo-Csv single-file writes → Write (pipelines stay allowed).
  if (
    /^(?:Export-Csv|epcsv|ConvertTo-Csv)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:ForEach-Object|%|Where-Object)\b/i.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b)/i.test(command)
  ) {
    return {
      prefer: 'Write',
      pattern: /^(?:ConvertTo-Csv)\b/i.test(command) ? 'ConvertTo-Csv' : 'Export-Csv',
      message: 'Use Write instead of PowerShell Export-Csv/ConvertTo-Csv for file dumps.',
    };
  }
  // Import-Clixml path dumps → Read; Export-Clixml path dumps → Write (pipelines stay allowed).
  if (
    /^(?:Import-Clixml)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b)/i.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'Import-Clixml',
      message: 'Use Read instead of PowerShell Import-Clixml for file content dumps.',
    };
  }
  if (
    /^(?:Export-Clixml)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:ForEach-Object|%|Where-Object)\b/i.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b)/i.test(command)
  ) {
    return {
      prefer: 'Write',
      pattern: 'Export-Clixml',
      message: 'Use Write instead of PowerShell Export-Clixml for file dumps.',
    };
  }
  // Select-Object path / Get-Content InputObject dumps → Read (pipelines stay allowed).
  if (
    /^(?:Select-Object|select)\b/i.test(command) &&
    !/\s\|/.test(command) &&
    /(?:\.[\w]+|\bPath\b|\bLiteralPath\b|\bFile\b|\bGet-Content\b|\bgc\b)/i.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'Select-Object',
      message: 'Use Read instead of PowerShell Select-Object for file content dumps.',
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
  // fd / fdfind — modern find alternatives (file-name search).
  // Pipelines already short-circuit; allow pure flags like `fd --help` via no-path still OK.
  if (/^(?:\/usr\/bin\/)?(?:fd|fdfind)(?:\s|$)/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'fd/fdfind',
      message: 'Use Glob for file-name search (gitignore-aware, capped) instead of fd/fdfind.',
    };
  }
  // `rg --files` / `rg --files -g '*.ts'` is a file lister, not content search.
  // Content search (`rg pattern`) is handled by matchGrepLike.
  if (
    /^(?:\/usr\/bin\/)?rg\b/.test(command) &&
    /(?:^|\s)--files(?:\s|$)/.test(command)
  ) {
    return {
      prefer: 'Glob',
      pattern: 'rg --files',
      message: 'Use Glob for file-name listing instead of rg --files.',
    };
  }
  // `git ls-files` tracked-path listing → Glob (gitignore-aware workspace listing).
  // Keep `git ls-files --stage` / plumbing with complex flags allowed only via force.
  if (/^(?:\/usr\/bin\/)?git\s+ls-files\b/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'git ls-files',
      message: 'Use Glob for workspace file listing instead of git ls-files.',
    };
  }
  // Windows recursive listing → Glob.
  // Bare `dir` / `Get-ChildItem` of a single directory stays allowed for navigation.
  // Recurse with or without -Filter/-Include floods context; prefer Glob.
  if (
    /^(?:Get-ChildItem|gci|dir)\b/i.test(command) &&
    /(?:-Recurse|\s\/s\b)/i.test(command)
  ) {
    return {
      prefer: 'Glob',
      pattern: 'Get-ChildItem/dir recurse',
      message: 'Use Glob for recursive file-name search instead of Get-ChildItem/dir.',
    };
  }
  // `tree` recursive dumps → Glob (workspace-capped listing). Pipelines stay allowed.
  if (/^(?:\/usr\/bin\/)?tree(?:\s|$)/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'tree',
      message: 'Use Glob or LioraTree for directory trees instead of tree.',
    };
  }
  // `ls -R` recursive listing (not plain `ls`).
  if (/^(?:\/bin\/|\/usr\/bin\/)?ls\b/.test(command) && /(?:^|\s)-[A-Za-z]*R\b/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'ls -R',
      message: 'Use Glob or LioraTree for recursive listings instead of ls -R.',
    };
  }
  // `where /r . *.ts` recursive file search (not `where.exe python` which is PATH lookup).
  if (/^where(?:\.exe)?\s+\/r\b/i.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'where /r',
      message: 'Use Glob for recursive file-name search instead of where /r.',
    };
  }
  // macOS Spotlight / Unix locate name indexes → Glob (workspace-scoped, capped).
  // `mdfind -onlyin` / `locate pattern` whole-command dumps flood context.
  if (/^(?:\/usr\/bin\/)?mdfind(?:\s|$)/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'mdfind',
      message: 'Use Glob for workspace file-name search instead of mdfind.',
    };
  }
  if (/^(?:\/usr\/bin\/)?locate(?:\s|$)/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'locate',
      message: 'Use Glob for workspace file-name search instead of locate.',
    };
  }
  // Bash `compgen -G '*.ts'` pathname expansion listing → Glob.
  if (/^compgen\s+-G\b/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'compgen -G',
      message: 'Use Glob for pathname expansion listing instead of compgen -G.',
    };
  }
  // PowerShell `Get-ChildItem -Name` / `gci -Name` is a recursive-capable name dump.
  // Bare `Get-ChildItem src` without -Name stays allowed for navigation.
  if (
    /^(?:Get-ChildItem|gci)\b/i.test(command) &&
    /(?:^|\s)-Name\b/i.test(command) &&
    !/(?:-Recurse|\s\/s\b)/i.test(command)
  ) {
    // Only block when the command is clearly listing many names (path + -Name),
    // not interactive inspection of a single known path without wildcards is still noisy —
    // route name-only listings to Glob for consistency.
    return {
      prefer: 'Glob',
      pattern: 'Get-ChildItem -Name',
      message: 'Use Glob for name-only file listing instead of Get-ChildItem -Name.',
    };
  }
  // ls *.ts only — ls of a directory is often legitimate navigation; only block `ls` with glob chars?
  // Too noisy — skip bare ls.
  return undefined;
}
