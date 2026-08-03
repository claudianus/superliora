/**
 * Conductor lane Bash read-only policy (meta-orchestrator v2 contract §2.1
 * item 3, checklist V1-5).
 *
 * The conductor keeps Bash for read-only inspection (`git status/log/diff`
 * and similar). Anything that can mutate files, packages, or git state is
 * hard-denied by {@link ConductorDirectWorkGuard} and routed to a Job.
 *
 * Classification is intentionally allowlist-based: an unrecognized command,
 * shell chaining trick, or suspicious flag is treated as a write. A false
 * deny merely delegates the command to a worker; a false allow lets direct
 * work run on the conductor lane.
 */

/** Split a command line into segments; every segment must be read-only. */
const CHAIN_SEPARATOR = /\r?\n|&&|\|\||[|;]/;

/** Shell features that can smuggle writes into an otherwise clean segment. */
const WRITE_SMUGGLERS =
  />>?|<|\$\(|`|\(|\)|\{|&|\btee\b|\bsudo\b|\bxargs\b|\beval\b|\bsource\b|\b\.\s/;

/** Plain inspection commands allowed on the conductor lane (first token). */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'ls',
  'll',
  'pwd',
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'ag',
  'wc',
  'file',
  'stat',
  'which',
  'whereis',
  'tree',
  'du',
  'df',
  'date',
  'echo',
  'printf',
  'env',
  'printenv',
  'whoami',
  'uname',
  'hostname',
  'id',
  'ps',
  'sort',
  'uniq',
  'cut',
  'tr',
  'column',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'cd',
  'true',
]);

/** git subcommands that never mutate state, regardless of flags. */
const GIT_PURE_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'rev-list',
  'ls-files',
  'ls-tree',
  'shortlog',
  'describe',
  'blame',
  'reflog',
  'merge-base',
  'cat-file',
  'grep',
]);

/** git global options that consume a following value token. */
const GIT_GLOBAL_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
]);

/** `find` flags that execute or delete — writes even though find reads. */
const FIND_WRITE_FLAGS: ReadonlySet<string> = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-fdelete',
]);

/** Flags that turn `git branch` into a mutation. */
const GIT_BRANCH_WRITE_FLAGS: ReadonlySet<string> = new Set([
  '-d',
  '-D',
  '-m',
  '-M',
  '-c',
  '-C',
  '-f',
  '--delete',
  '--move',
  '--copy',
  '--force',
  '--edit',
  '--set-upstream',
  '--set-upstream-to',
  '-u',
  '--unset-upstream',
  '--track',
  '--no-track',
]);

/** Flags that turn `git config` into a write. */
const GIT_CONFIG_WRITE_MARKERS =
  /--(?:set|add|replace-all|unset|unset-all|rename-section|remove-section)\b/;

function tokens(segment: string): string[] {
  return segment.trim().split(/\s+/).filter((token) => token.length > 0);
}

function basenameOf(command: string): string {
  const last = command.split('/').pop() ?? command;
  return last;
}

function isGitSegmentReadOnly(parts: string[]): boolean {
  // Skip leading global options (`git -C /repo log`, `git -c a=b status`).
  let index = 1;
  while (index < parts.length) {
    const token = parts[index];
    if (token === undefined || !token.startsWith('-')) break;
    index += GIT_GLOBAL_VALUE_OPTIONS.has(token) ? 2 : 1;
  }
  const subcommand = parts[index];
  if (subcommand === undefined || subcommand.startsWith('-')) return false;
  const rest = parts.slice(index + 1);

  if (GIT_PURE_READ_SUBCOMMANDS.has(subcommand)) return true;

  switch (subcommand) {
    case 'branch':
      return !rest.some((flag) => GIT_BRANCH_WRITE_FLAGS.has(flag));
    case 'tag':
      // Listing only: `git tag`, `git tag -l`, `git tag --list`.
      return rest.every((flag) => flag.startsWith('-')) &&
        !rest.some((flag) => flag === '-d' || flag === '-D' || flag === '-a' || flag === '-s');
    case 'stash': {
      const action = rest.find((token) => !token.startsWith('-'));
      return action === 'list' || action === 'show';
    }
    case 'remote': {
      const action = rest.find((token) => !token.startsWith('-'));
      return action === undefined; // bare `git remote` / `git remote -v` lists
    }
    case 'config':
      return !GIT_CONFIG_WRITE_MARKERS.test(rest.join(' ')) &&
        rest.some((flag) => flag === '--get' || flag === '--get-all' || flag === '--list' || flag === '-l');
    case 'worktree': {
      const action = rest.find((token) => !token.startsWith('-'));
      return action === 'list';
    }
    default:
      return false;
  }
}

function isPlainSegmentReadOnly(parts: string[]): boolean {
  const [command, ...rest] = parts;
  if (command === undefined) return false;
  const name = basenameOf(command);
  if (name === 'find') {
    return !rest.some((flag) => FIND_WRITE_FLAGS.has(flag));
  }
  if (READ_ONLY_COMMANDS.has(name)) {
    // Version probes only (`node --version`) stay off-lane: unknown binaries
    // can do anything, so plain-list membership is the sole pass ticket.
    return true;
  }
  return false;
}

/**
 * Whether a Bash command line is safe to run directly on the conductor lane.
 * Every chained segment must be a known read-only command; git mutations,
 * redirection, substitution, and unrecognized binaries are all denied.
 */
export function isConductorBashCommandReadOnly(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;

  for (const segment of trimmed.split(CHAIN_SEPARATOR)) {
    if (segment.trim().length === 0) continue;
    if (WRITE_SMUGGLERS.test(segment)) return false;
    const parts = tokens(segment);
    if (parts.length === 0) continue;
    const isReadOnly =
      parts[0] === 'git' ? isGitSegmentReadOnly(parts) : isPlainSegmentReadOnly(parts);
    if (!isReadOnly) return false;
  }
  return true;
}
