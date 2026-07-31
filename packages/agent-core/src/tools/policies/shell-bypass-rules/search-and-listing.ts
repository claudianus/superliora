/**
 * Whole-command content-search (Grep) bypass detector, plus the single-file
 * hash/property-list/XML dump helpers it uses (these are metadata dumps
 * that still prefer Read).
 */

import type { ShellDedicatedBypassHit } from './types';

/**
 * True when a unix checksum utility is hashing exactly one concrete path.
 * Multi-file args, globs, and option-only forms stay allowed for real shell work.
 */
function isSingleUnixHashFileDump(command: string): boolean {
  // Strip the utility name (+ optional busybox / absolute path prefix).
  const rest = command
    .replace(
      /^(?:\/(?:usr\/bin|sbin|bin)\/)?(?:busybox\s+)?(?:g?md5sum|g?sha1sum|g?sha224sum|g?sha256sum|g?sha384sum|g?sha512sum|shasum|cksum)\b/i,
      '',
    )
    .trim();
  if (rest.length === 0) return false;
  // Drop known option tokens so only path operands remain.
  // shasum: -a 256 / --algorithm 256; others: -b/--binary -t/--text --tag -z/--zero
  let args = rest
    .replaceAll(/(?:^|\s)(?:--algorithm|-a)(?:=\S+|\s+\S+)/gi, ' ')
    .replaceAll(
      /(?:^|\s)(?:--binary|--text|--tag|--zero|-b|-t|-z)(?:=\S+)?(?=\s|$)/gi,
      ' ',
    )
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (args.length === 0) return false;
  // Globs or multiple operands → real shell work.
  if (/[*?[{]/.test(args)) return false;
  const parts = args.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length !== 1) return false;
  const path = parts[0] ?? '';
  // Require a path-like token (has extension or path separators).
  return isPathLikeHashOperand(path);
}

/**
 * macOS / BSD `md5` (distinct from coreutils `md5sum`).
 * Allows quiet/raw flags: `md5 -q file`, `md5 -r file`.
 */
function isSingleMacMd5FileDump(command: string): boolean {
  const rest = command.replace(/^(?:\/(?:usr\/bin|sbin|bin)\/)?md5\b/i, '').trim();
  if (rest.length === 0) return false;
  // Reject string-hash mode (`md5 -s 'hello'`) and multi-file dumps.
  if (/(?:^|\s)-(?:s|string)(?:=\S+|\s+\S+)/i.test(rest)) return false;
  let args = rest
    .replaceAll(/(?:^|\s)-(?:q|r|p|x|t)(?=\s|$)/gi, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (args.length === 0) return false;
  if (/[*?[{]/.test(args)) return false;
  const parts = args.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length !== 1) return false;
  return isPathLikeHashOperand(parts[0] ?? '');
}

/**
 * `plutil -p Info.plist` or `plutil -convert xml1 -o - Info.plist` (stdout dump).
 * In-place convert without `-o -` and multi-file args stay allowed.
 */
function isSinglePlutilFileDump(command: string): boolean {
  // Pretty-print dump.
  if (/^(?:\/usr\/bin\/)?plutil\s+-p\b/.test(command)) {
    const rest = command.replace(/^(?:\/usr\/bin\/)?plutil\s+-p\b/i, '').trim();
    if (rest.length === 0 || /[*?[{]/.test(rest)) return false;
    const parts = rest.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 1) return false;
    return isPathLikeHashOperand(parts[0] ?? '');
  }
  // Convert to stdout: must include `-o -` (or `--output -`) and one path.
  if (
    /^(?:\/usr\/bin\/)?plutil\s+-convert\b/.test(command) &&
    /(?:^|\s)-(?:o|output)\s+-(?:\s|$)/.test(command)
  ) {
    let rest = command.replace(/^(?:\/usr\/bin\/)?plutil\s+-convert\s+\S+/i, '').trim();
    rest = rest
      .replaceAll(/(?:^|\s)-(?:o|output)\s+-?(?=\s|$)/gi, ' ')
      .replaceAll(/(?:^|\s)--\s+/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
    if (rest.length === 0 || /[*?[{]/.test(rest)) return false;
    const parts = rest.split(/\s+/).filter((part) => part.length > 0 && !part.startsWith('-'));
    if (parts.length !== 1) return false;
    return isPathLikeHashOperand(parts[0] ?? '');
  }
  return false;
}

/**
 * `PlistBuddy -c Print Info.plist` / `PlistBuddy -c 'Print :key' Info.plist`.
 * Only pure Print dumps; mutating -c commands stay allowed.
 */
function isSinglePlistBuddyPrintDump(command: string): boolean {
  // Must not include mutating subcommands in any -c argument.
  if (/\b(?:Set|Add|Delete|Merge|Clear|Copy|Import|Save)\b/i.test(command)) {
    // Allow "Print" dumps that mention those words only inside paths — rare.
    // If a -c string contains a mutator, leave it alone.
    if (/(?:^|\s)-c\s+['"]?(?:Set|Add|Delete|Merge|Clear|Copy|Import|Save)\b/i.test(command)) {
      return false;
    }
  }
  // Strip utility + all -c '…' / -c "…" / -c Print chunks; leftover should be one path.
  let rest = command
    .replace(/^(?:\/usr\/libexec\/|\/usr\/bin\/)?PlistBuddy\b/i, '')
    .trim();
  rest = rest
    .replaceAll(/(?:^|\s)-c\s+(?:'[^']*'|"[^"]*"|\S+)/gi, ' ')
    .replaceAll(/(?:^|\s)-x(?=\s|$)/gi, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (rest.length === 0 || /[*?[{]/.test(rest)) return false;
  const parts = rest.split(/\s+/).filter((part) => part.length > 0 && !part.startsWith('-'));
  if (parts.length !== 1) return false;
  return isPathLikeHashOperand(parts[0] ?? '');
}

/**
 * `xmllint --format a.xml` / `xmllint --xpath '//x' a.xml` single-file dumps.
 *
 * Note: do not use `\b` before `--flag` — `-` is non-word, so `\b--format`
 * never matches after a space.
 */
function isSingleXmllintFileDump(command: string): boolean {
  // Must be a format/xpath/encode dump, not a full interactive shell.
  const hasDumpFlag =
    /(?:^|\s)--(?:format|xpath|encode|c14n|noblanks)(?:=\S+|\s|$)/.test(command);
  if (!hasDumpFlag) {
    // Bare `xmllint file.xml` also dumps parsed XML to stdout — catch path-only form.
    const bare = command.replace(/^(?:\/usr\/bin\/)?xmllint\b/i, '').trim();
    if (bare.length === 0 || /[*?[{]/.test(bare)) return false;
    if (/(?:^|\s)--\S+/.test(bare)) return false;
    const parts = bare.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 1) return false;
    return isPathLikeHashOperand(parts[0] ?? '');
  }
  let rest = command.replace(/^(?:\/usr\/bin\/)?xmllint\b/i, '').trim();
  // Drop known dump flags (and their single values for --xpath / --encode).
  rest = rest
    .replaceAll(/(?:^|\s)--xpath(?:=\S+|\s+\S+)/gi, ' ')
    .replaceAll(/(?:^|\s)--encode(?:=\S+|\s+\S+)/gi, ' ')
    .replaceAll(
      /(?:^|\s)--(?:format|c14n|noblanks|noout|nonet|nowarning|quiet)(?=\s|$)/gi,
      ' ',
    )
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (rest.length === 0 || /[*?[{]/.test(rest)) return false;
  const parts = rest.split(/\s+/).filter((part) => part.length > 0 && !part.startsWith('-'));
  if (parts.length !== 1) return false;
  return isPathLikeHashOperand(parts[0] ?? '');
}

function isPathLikeHashOperand(path: string): boolean {
  return (
    /(?:\.\/|\.\.\/|\/|[\w.-]+\/|[\w.-]+\\)/.test(path) ||
    /\.\w{1,8}$/.test(path)
  );
}

/**
 * True when openssl dgst / openssl md5|sha* is hashing exactly one concrete path.
 */
function isSingleOpensslDgstFileDump(command: string): boolean {
  const rest = command
    .replace(/^(?:\/usr\/bin\/)?openssl\s+(?:dgst|md5|sha1|sha256|sha512)\b/i, '')
    .trim();
  if (rest.length === 0) return false;
  // Multi-arg real shell work (write signature, HMAC, custom out file).
  if (/(?:^|\s)-(?:out|hmac|mac|macopt|signature|keyform|passin)(?:=\S+|\s+\S+)/i.test(rest)) {
    return false;
  }
  let args = rest
    .replaceAll(/(?:^|\s)-(?:sha\d+|md5|blake2\w*|sm3|rmd\d+|whirlpool|r|hex|binary|c)(?=\s|$)/gi, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (args.length === 0) return false;
  if (/[*?[{]/.test(args)) return false;
  const parts = args.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length !== 1) return false;
  const path = parts[0] ?? '';
  return isPathLikeHashOperand(path);
}

export function matchGrepLike(command: string): ShellDedicatedBypassHit | undefined {
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
  // Skips: multi-file args, globs, pipelines, check mode, openssl without a path.
  // Includes coreutils names plus g-prefixed Homebrew ports (gsha256sum, gmd5sum).
  if (
    /^(?:\/(?:usr|sbin|bin)\/)?(?:busybox\s+)?(?:g?md5sum|g?sha1sum|g?sha224sum|g?sha256sum|g?sha384sum|g?sha512sum|shasum|cksum)\b/.test(
      command,
    ) &&
    !/\s\|/.test(command) &&
    // `-c` / `--check` verify mode stays allowed (not a pure single-file dump).
    !/(?:^|\s)(?:-c|--check)(?:\s|=|$)/.test(command)
  ) {
    // Bare stdin / multi-file / glob work stays allowed; only one concrete path.
    if (isSingleUnixHashFileDump(command)) {
      return {
        prefer: 'Read',
        pattern: 'unix hash file',
        message:
          'Use Read (or package-script hash tooling) instead of md5sum/sha*sum/cksum for single-file dumps.',
      };
    }
  }
  // macOS / BSD `md5` (not md5sum) single-file dump → Read.
  // `md5 -q file`, `md5 -r file`, `/sbin/md5 file`. Multi-file / stdin stay allowed.
  if (
    /^(?:\/(?:usr\/bin|sbin|bin)\/)?md5\b/.test(command) &&
    !/\s\|/.test(command) &&
    !/\bmd5sum\b/.test(command)
  ) {
    if (isSingleMacMd5FileDump(command)) {
      return {
        prefer: 'Read',
        pattern: 'macos md5 file',
        message: 'Use Read (or package-script hash tooling) instead of md5 for single-file dumps.',
      };
    }
  }
  // plutil pretty-print / convert-to-stdout of a single plist → Read.
  // In-place convert (`plutil -convert xml1 Info.plist`) and multi-file stay allowed.
  if (/^(?:\/usr\/bin\/)?plutil\b/.test(command) && !/\s\|/.test(command)) {
    if (isSinglePlutilFileDump(command)) {
      return {
        prefer: 'Read',
        pattern: 'plutil file',
        message: 'Use Read instead of plutil for single-file property list dumps.',
      };
    }
  }
  // PlistBuddy -c Print of a single plist → Read (macOS property list dump).
  // Mutating commands (Set/Add/Delete/Merge/Clear/Copy) stay allowed.
  if (
    /^(?:\/usr\/libexec\/|\/usr\/bin\/)?PlistBuddy\b/.test(command) &&
    !/\s\|/.test(command) &&
    /(?:^|\s)-c\s+['"]?Print\b/i.test(command)
  ) {
    if (isSinglePlistBuddyPrintDump(command)) {
      return {
        prefer: 'Read',
        pattern: 'PlistBuddy Print',
        message: 'Use Read instead of PlistBuddy -c Print for single-file property list dumps.',
      };
    }
  }
  // xmllint --format / --xpath of a single local xml file → Read.
  // Network / DTD fetch modes and multi-file stay allowed.
  if (
    /^(?:\/usr\/bin\/)?xmllint\b/.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:--html|--shell|--path)\b/.test(command)
  ) {
    if (isSingleXmllintFileDump(command)) {
      return {
        prefer: 'Read',
        pattern: 'xmllint file',
        message: 'Use Read instead of xmllint for single-file XML dumps.',
      };
    }
  }
  if (
    /^(?:\/usr\/bin\/)?openssl\s+(?:dgst|md5|sha1|sha256|sha512)\b/.test(command) &&
    !/\s\|/.test(command) &&
    !/\b(?:-verify|-prverify|-sign)\b/.test(command)
  ) {
    if (isSingleOpensslDgstFileDump(command)) {
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

export function matchGlobLike(command: string): ShellDedicatedBypassHit | undefined {
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
      message: 'Use Glob or RepoQuery (mode=path) for directory trees instead of tree.',
    };
  }
  // `ls -R` recursive listing (not plain `ls`).
  if (/^(?:\/bin\/|\/usr\/bin\/)?ls\b/.test(command) && /(?:^|\s)-[A-Za-z]*R\b/.test(command)) {
    return {
      prefer: 'Glob',
      pattern: 'ls -R',
      message: 'Use Glob or RepoQuery (mode=path) for recursive listings instead of ls -R.',
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
