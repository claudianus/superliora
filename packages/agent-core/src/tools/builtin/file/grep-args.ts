import {
  SENSITIVE_GLOBS_TO_EXCLUDE,
  VCS_DIRECTORIES_TO_EXCLUDE,
} from '../../support/run-rg';

import type { GrepInput } from './grep-schema';

// Column cap applied to non-content output modes only; `content` mode returns
// matching lines in full so the cap is intentionally skipped there.
const RG_MAX_COLUMNS = 500;

export function buildRgArgs(
  rgPath: string,
  args: GrepInput,
  searchPaths: readonly string[],
  singleThreaded = false,
): string[] {
  const cmd: string[] = [rgPath];
  if (singleThreaded) cmd.push('-j', '1');
  cmd.push('--hidden');
  const mode = args.output_mode ?? 'files_with_matches';
  // `content` mode returns matching lines verbatim. Capping columns here would
  // make rg replace any line wider than the cap with a placeholder, silently
  // dropping the actual match text. The cap is only useful outside `content`
  // mode, where line text is never surfaced.
  if (mode !== 'content') {
    cmd.push('--max-columns', String(RG_MAX_COLUMNS));
  }
  cmd.push('--null');
  for (const dir of VCS_DIRECTORIES_TO_EXCLUDE) {
    cmd.push('--glob', `!${dir}`);
  }

  if (mode === 'files_with_matches') cmd.push('-l');
  else if (mode === 'count_matches') {
    // rg omits the filename when only one file is searched, so pin it on. Without
    // this, the per-file line collapses to a bare count and the summary parser
    // disagrees with the displayed number.
    cmd.push('--count-matches', '--with-filename');
  }

  if (args['-i']) cmd.push('-i');
  if (mode === 'content') {
    cmd.push('--with-filename');
    if (args['-n'] !== false) {
      cmd.push('-n');
    } else {
      cmd.push('--field-context-separator', ':');
    }
    if (args['-C'] !== undefined) {
      cmd.push('-C', String(args['-C']));
    } else {
      if (args['-A'] !== undefined) cmd.push('-A', String(args['-A']));
      if (args['-B'] !== undefined) cmd.push('-B', String(args['-B']));
    }
  }
  if (args.glob !== undefined) cmd.push('--glob', args.glob);
  if (args.type !== undefined) cmd.push('--type', args.type);
  if (args.multiline) cmd.push('-U', '--multiline-dotall');
  if (args.include_ignored) cmd.push('--no-ignore');
  for (const glob of SENSITIVE_GLOBS_TO_EXCLUDE) {
    // Appended after user globs so a broad include such as `**/.env` cannot
    // undo this first-pass exclusion. Explicit file paths are still protected
    // by the post-processing filter because rg intentionally searches them.
    cmd.push('--glob', `!${glob}`);
  }
  // Do not forward `head_limit` to `rg --max-count`: omitted means "use the
  // tool default", head_limit=0 means "unlimited", while `rg --max-count 0`
  // means "zero matches per file". Pagination happens in post-processing.

  cmd.push('--', args.pattern, ...searchPaths);
  return cmd;
}
