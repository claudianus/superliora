/**
 * Detect shell commands that are pure file I/O / search and should use
 * dedicated tools (Read, Write, Edit, Grep, Glob) instead of Bash.
 *
 * Only matches **whole-command** simple shapes — pipelines, `&&` chains,
 * subshells, and real process work are allowed through. False positives
 * would break legitimate scripts; false negatives only leave power idle.
 *
 * Rule matchers are grouped by category under `shell-bypass-rules/`; this
 * file composes and dispatches them in the exact order the previous
 * monolithic implementation checked them, so behavior is unchanged.
 */

import { hasShellComposition, stripLeadingShellUtilityWrappers } from './shell-bypass-rules/composition';
import { matchClipboardFileBypass } from './shell-bypass-rules/clipboard';
import { matchGrepLike, matchGlobLike } from './shell-bypass-rules/search-and-listing';
import { matchLanguageReadLike, matchLanguageWriteLike } from './shell-bypass-rules/language';
import {
  matchFileDumpPipeWriteBypass,
  matchFilePagerPipeReadBypass,
  matchPowerShellPipeReadBypass,
  matchPowerShellPipeWriteBypass,
  matchStartTranscriptWrite,
} from './shell-bypass-rules/powershell-pipes';
import {
  matchEditLike,
  matchEmptyRedirectWrite,
  matchSimpleFileCopyWrite,
  matchSimpleHeredocWrite,
  matchSimpleRedirectWrite,
  matchWriteLike,
} from './shell-bypass-rules/redirects-and-copies';
import { matchReadLike } from './shell-bypass-rules/text-dumpers';
import type { ShellDedicatedBypassHit } from './shell-bypass-rules/types';

export type { ShellDedicatedBypassHit } from './shell-bypass-rules/types';

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

export function formatShellDedicatedBypassError(hit: ShellDedicatedBypassHit): string {
  return [
    `Bash blocked: this looks like a job for the ${hit.prefer} tool (${hit.pattern}).`,
    hit.message,
    `If you truly need the shell for this, prefix with \`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} \` and explain why in description.`,
  ].join(' ');
}
