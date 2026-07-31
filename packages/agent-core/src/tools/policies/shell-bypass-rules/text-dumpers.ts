/**
 * Whole-command text/file dumpers: pagers, formatters, decoders, and VCS
 * blob dumps (cat/head/tail/less/bat/sed -n/awk/od/jq/git show/…) that
 * should prefer Read, plus the handful of single-file PowerShell writer
 * cmdlets (Set-Content/Tee-Object/New-Item/…) detected within the same
 * whole-command shapes.
 */

import type { ShellDedicatedBypassHit } from './types';

export function matchReadLike(command: string): ShellDedicatedBypassHit | undefined {
  // cat [flags] path  (+ busybox/gcat/batcat aliases)
  if (
    /^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?cat|batcat)(?:\s+-[A-Za-z]+)*\s+\S+\s*$/.test(command)
  ) {
    return {
      prefer: 'Read',
      pattern: 'cat file',
      message: 'Use Read (edit-ready bytes) or RepoQuery (outline/content) instead of cat.',
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
  // Flags may take a following value token: head -n 20 file, tail -50 file,
  // head -n20 file, tail -c +10 file (GNU byte offsets with leading +).
  if (
    /^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?head|g?tail)(?:\s+-[A-Za-z0-9]+(?:\s+[+]?\d+)?)*(?:\s+\S+)\s*$/.test(
      command,
    )
  ) {
    return {
      prefer: 'Read',
      pattern: 'head/tail file',
      message: 'Use Read with line_offset/n_lines (or RepoQuery mode=outline) instead of head/tail.',
    };
  }
  // less/more/most/nl path — pure pagers / numberers dumping a single file.
  // Flags may take values (`nl -n ln file`, `nl -w 3 file`, `less -N file`).
  // Strip flag(+value) pairs first so bare `nl -n ln` / `less -N` stay allowed.
  if (/^(?:\/usr\/bin\/)?(?:less|more|most|nl)\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?(?:less|more|most|nl)\b/, '')
      // nl value-taking short opts: -n STYLE, -b STYLE, -w N, -v N, -i N, -l N, -s STR, -d STR
      .replaceAll(/(?:^|\s)-[nbwvilsd]\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9=]+/g, ' ')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'pager file',
        message: 'Use Read instead of a pager for file contents.',
      };
    }
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
      message: 'Use Read or RepoQuery instead of bat/tac/rev for file contents.',
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
      .replaceAll(/(?:^|\s)-[A-Za-z0-9]+(?:\s+\S+)?/g, ' ')
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

  // cut single-file field/byte dumps: cut -d, -f1 file, cut -c1-10 file.
  // Multi-file cut and stdin (`cut -f1` / `cut -f1 -`) stay allowed.
  if (/^(?:\/usr\/bin\/)?cut\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?cut\b/, '')
      // Attached first: -d,, -f1, -c1-10, --delimiter=,
      .replaceAll(/(?:^|\s)-[dfcb]\S+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:delimiter|fields|characters|bytes)=[^\s]+/g, ' ')
      // Bare letter + separate value: -d , -f 1 -c 1-10
      .replaceAll(/(?:^|\s)-[dfcb]\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:delimiter|fields|characters|bytes)\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9=]+/g, ' ')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'cut file',
        message: 'Use Read instead of cut for single-file content dumps.',
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
      message: 'Use Read or RepoQuery instead of text formatters for file contents.',
    };
  }

  // sort/uniq/shuf single-file dumps — multi-file sort/merge and stdin stay allowed.
  // Value-taking short opts (`sort -k 2 file`, `sort -t , file`, `uniq -f 1 file`)
  // must not leave orphan value tokens that look like extra paths.
  if (/^(?:\/usr\/bin\/)?(?:sort|uniq|shuf|gsort)\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?(?:sort|uniq|shuf|gsort)\b/, '')
      // Attached first: -k2, -t,, -oout, -S50%, --key=2
      .replaceAll(/(?:^|\s)-[ktoS]\S+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:key|field-separator|output|buffer-size)=[^\s]+/g, ' ')
      // Bare letter + separate value: -k 2, -t ,, -o out, -S 50%, -f 1 (uniq), -s 2 (uniq)
      .replaceAll(/(?:^|\s)-[ktoSfs]\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:key|field-separator|output|buffer-size)\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
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
      .replaceAll(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
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

  // sed/gsed/busybox sed -n print range (not -i) with a file path.
  // Require a trailing non-flag path so bare `sed -n '1,20p'` (stdin) stays allowed.
  if (
    /^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?sed)\b/.test(command) &&
    /(?:^|\s)-n(?:\s|$)/.test(command) &&
    !/(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\s|$)/.test(command) &&
    /(?:^|\s)(?!-)\S+\s*$/.test(command) &&
    // script/expression alone is not a path; need a path after the last -e/-f/quoted script
    (() => {
      const withoutOpts = command
        .replace(/^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:g?sed)\b/, '')
        .replaceAll(/(?:^|\s)-[A-Za-z]*n[A-Za-z]*/g, ' ')
        .replaceAll(/(?:^|\s)-[ef]\s+\S+/g, ' ')
        .replaceAll(/(?:^|\s)--(?:expression|file)=[^\s]+/g, ' ')
        .replaceAll(/(?:^|\s)-[A-Za-z0-9=]+/g, ' ')
        .replaceAll(/(?:^|\s)'[^']*'/g, ' ')
        .replaceAll(/(?:^|\s)"[^"]*"/g, ' ')
        .trim();
      const args = withoutOpts.split(/\s+/).filter(Boolean);
      return args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-');
    })()
  ) {
    return {
      prefer: 'Read',
      pattern: 'sed -n file',
      message: 'Use Read with line_offset/n_lines instead of sed -n for file windows.',
    };
  }

  // awk/gawk/nawk/busybox awk one-file dumpers: awk 1 file, awk '{print}' file
  // Strip programs/options first so bare `awk 1` / `awk '{print}'` (stdin) stay allowed.
  if (/^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:awk|gawk|nawk)\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?(?:busybox\s+)?(?:awk|gawk|nawk)\b/, '')
      // Attached first: -F, -F',' -fprog -vvar=1 (must not swallow the program token).
      .replaceAll(/(?:^|\s)-[Ffv]\S+/g, ' ')
      // Then bare letter + separate value: -F FS, -f prog, -v x=1
      .replaceAll(/(?:^|\s)-[Ffv]\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:file|source)=[^\s]+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9=]+/g, ' ')
      .replaceAll(/(?:^|\s)'[^']*'/g, ' ')
      .replaceAll(/(?:^|\s)"[^"]*"/g, ' ')
      // bare program tokens like `1` or `{print}` without a path
      .replaceAll(/(?:^|\s)(?:1|\{[^}]*\})\b/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'awk file',
        message: 'Use Read or Grep instead of awk for whole-file dumps.',
      };
    }
  }

  // binary/text dumpers aimed at a single path
  // Allow short flags, long flags (`base64 --decode file`), and numeric flag values
  // (`strings -n 8 file`, `xxd -l 100 file`) while still requiring a non-flag path
  // token so bare `od -An` / `base64 -d` stay allowed.
  if (
    /^(?:\/usr\/bin\/)?(?:od|hexdump|xxd|strings|base64|base32)(?:\s+(?:--[A-Za-z0-9-]+(?:=[^\s]+)?|-[A-Za-z0-9=]+|\d+))*\s+(?!-)\S+\s*$/.test(
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
      .replaceAll(/(?:^|\s)-(?:f|t|c|o|l|s)\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:from-code|to-code)=[^\s]+/g, ' ')
      .replaceAll(/(?:^|\s)--(?:from-code|to-code)\s+\S+/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9]+(?:=[^\s]+)?/g, ' ')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
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

  // jq/yq whole-file pretty-print / dump (no pipeline, single path arg).
  // Support `yq e . file` and require a real path so bare `jq .` / `jq -c .` stay allowed.
  if (/^(?:\/usr\/bin\/)?(?:jq|yq)\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?(?:jq|yq)\b/, '')
      // yq eval verbs: e / eval / ea / eval-all
      .replace(/^(?:\s+)(?:e|eval|ea|eval-all)\b/i, ' ')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9=]+/g, ' ')
      // filter expression: `.`, `.name`, `'.name'`, `".items[0]"`
      .replaceAll(/(?:^|\s)'[^']*'/g, ' ')
      .replaceAll(/(?:^|\s)"[^"]*"/g, ' ')
      .replaceAll(/(?:^|\s)\.[A-Za-z0-9_.[\]*]*/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-') && args[0] !== '.') {
      return {
        prefer: 'Read',
        pattern: 'jq/yq file',
        message: 'Use Read instead of jq/yq for whole-file JSON/YAML dumps.',
      };
    }
  }

  // python -m json.tool path  (pretty-print dump of a JSON file).
  // Require a real path so bare `python -m json.tool` / `python -m json.tool -` (stdin) stay allowed.
  if (/^(?:\/usr\/bin\/)?python(?:3(?:\.\d+)?)?\s+-m\s+json\.tool\b/.test(command)) {
    const withoutOpts = command
      .replace(/^(?:\/usr\/bin\/)?python(?:3(?:\.\d+)?)?\s+-m\s+json\.tool\b/, '')
      .replaceAll(/(?:^|\s)--[A-Za-z0-9-]+(?:=[^\s]+)?/g, ' ')
      .replaceAll(/(?:^|\s)-[A-Za-z0-9=]+/g, ' ')
      .trim();
    const args = withoutOpts.split(/\s+/).filter(Boolean);
    if (args.length === 1 && args[0] !== '-' && !args[0]!.startsWith('-')) {
      return {
        prefer: 'Read',
        pattern: 'python -m json.tool file',
        message: 'Use Read instead of python -m json.tool for JSON file dumps.',
      };
    }
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
