import { utf8Prefix } from '@superliora/sdk';
/** Bounded display of literal heredoc input, never an assertion that a file was written. */
import { COMMAND_PREVIEW_LINES } from '#/tui/constant/rendering';
import { STREAMING_ARGS_PREVIEW_MAX_BYTES } from '#/tui/constant/streaming';
import { currentTheme } from '#/tui/theme';
import { highlightLines, langFromPath } from './code-highlight';

export function formatBashHeredocPreview(command: string): string[] | undefined {
  return buildBashHeredocPreview(command)?.sourceLines;
}

/**
 * Separate shell context from source so the main card never paints the body twice.
 * `maxLines` bounds both the context and source tails; `'all'` keeps the
 * whole command (an expanded card must show everything that ran).
 */
export function buildBashHeredocPreview(command: string, maxLines: number | 'all' = COMMAND_PREVIEW_LINES): {
  readonly commandContext: string;
  readonly sourceLines: string[];
} | undefined {
  // A preview recognizer, not a shell interpreter. Leave compound/multiple
  // heredocs and dynamic delimiters to the ordinary bash command renderer.
  // Past the byte cap the delimiter and any later shell command are
  // unverified, so a source-only preview could hide what actually runs.
  if (utf8Prefix(command, STREAMING_ARGS_PREVIEW_MAX_BYTES).length < command.length) return undefined;
  const lines = command.split('\n');
  const opening = lines.findIndex((line) => /<<-?\s*/.test(line));
  if (opening < 0) return undefined;
  const header = lines[opening]!;
  if (/[;&|`]/.test(header)) return undefined;
  const matches = [...header.matchAll(/<<(-?)\s*(?:'([\w]+)'|"([\w]+)"|([\w]+))/g)];
  if (matches.length !== 1 || (header.match(/<</g)?.length ?? 0) !== 1) return undefined;
  const match = matches[0]!;
  const remainingHeader = header.slice(0, match.index) + header.slice(match.index + match[0].length);
  const catInput = /^\s*cat\s*(?:>{1,2}\s*(?:'[^'\n]+'|"[^"\n]+"|[^\s;&|<>'"]+))?\s*$/.test(remainingHeader);
  const interpreter = /^\s*(python3?|node)\s+-\s*$/.exec(remainingHeader)?.[1];
  const patchInput = /^\s*apply_patch\s*$/.test(remainingHeader);
  if (!catInput && interpreter === undefined && !patchInput) return undefined;
  const delimiter = match[2] ?? match[3] ?? match[4]!;
  const stripTabs = match[1] === '-';
  // Only literal redirect paths supply a language hint; never evaluate shell.
  const pathMatch = /(?:^|\s)>{1,2}\s*(?:'([^'\n]+)'|"([^"\n]+)"|([^\s;&|<>]+))/.exec(header);
  const path = pathMatch?.[1] ?? pathMatch?.[2] ?? pathMatch?.[3];
  const literalPath = path !== undefined && !/[$`\\]/.test(path) ? path : undefined;
  const language = interpreter === 'node'
    ? 'javascript'
    : interpreter !== undefined
      ? 'python'
      : patchInput
        ? 'diff'
        : literalPath === undefined ? undefined : langFromPath(literalPath);
  const body: string[] = [];
  for (let index = opening + 1; index < lines.length; index++) {
    const line = lines[index]!;
    const normalized = stripTabs ? line.replace(/^\t+/, '') : line;
    if (normalized === delimiter) {
      // A source-only preview must never hide a later shell command. Keep
      // compound scripts on the normal shell path rather than presenting
      // only their first heredoc.
      if (lines.slice(index + 1).some((suffix) => suffix.trim().length > 0)) {
        return undefined;
      }
      break;
    }
    body.push(normalized);
  }
  if (body.every((line) => line.length === 0)) return undefined;
  const start = maxLines === 'all' ? 0 : Math.max(0, body.length - maxLines);
  // Tokenize only the visible slice. Unknown languages stay plain.
  const highlighted = highlightLines(body.slice(start).join('\n'), language);
  return {
    commandContext: lines.slice(maxLines === 'all' ? 0 : Math.max(0, opening - maxLines + 1), opening + 1).join('\n'),
    sourceLines: [
      currentTheme.dim(`INPUT · Bash heredoc (${interpreter !== undefined ? 'script input; ' : patchInput ? 'patch input; ' : ''}not execution output)`),
      ...highlighted.map((line, i) => currentTheme.dim(`${String(start + i + 1).padStart(4)}  `) + line),
    ],
  };
}
