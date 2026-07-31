import type { ShellDedicatedBypassHit } from './types';

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
