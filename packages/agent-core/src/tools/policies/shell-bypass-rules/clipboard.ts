import type { ShellDedicatedBypassHit } from './types';

/**
 * Clipboard utilities used as file dump/load shims.
 * Matches:
 *   - pbcopy < path / pbpaste > path
 *   - xclip / xsel / wl-copy with a single path arg
 * Skips: bare pbcopy (stdin from pipeline), multi-arg real shell work.
 */
export function matchClipboardFileBypass(command: string): ShellDedicatedBypassHit | undefined {
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
