/**
 * Pipe-composition bypass detectors that must run *before* the generic
 * shell-composition guard: pure value/file producers piped straight into a
 * single PowerShell-flavored (or cross-platform) file sink/formatter/pager.
 * Real multi-stage or process-heavy pipelines stay allowed.
 */

import type { ShellDedicatedBypassHit } from './types';

/**
 * Pure PowerShell value producers piped into file writers.
 * Matches:
 *   - Write-Output/Write-Host/echo … | Set-Content/Out-File/Add-Content/Tee-Object/sponge path
 *   - 'literal' / "literal" | Set-Content path
 *   - $null / numeric / range constants | Set-Content path
 * Skips: real process left-hand sides, multi-pipe chains, &&/|| lists.
 */
export function matchPowerShellPipeWriteBypass(command: string): ShellDedicatedBypassHit | undefined {
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
  if (hereStringMatch === null && command.includes('\n')) return undefined;
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
    !((m[1] ?? '').startsWith('@')) &&
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
export function matchFileDumpPipeWriteBypass(command: string): ShellDedicatedBypassHit | undefined {
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
export function matchFilePagerPipeReadBypass(command: string): ShellDedicatedBypassHit | undefined {
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
export function matchPowerShellPipeReadBypass(command: string): ShellDedicatedBypassHit | undefined {
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
export function matchStartTranscriptWrite(command: string): ShellDedicatedBypassHit | undefined {
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
