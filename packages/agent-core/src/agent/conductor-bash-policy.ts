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

/**
 * Flags that turn an otherwise read-only command into a write or an exec.
 * `sort -o` and `tree -o` redirect to a file without a shell redirect, `date
 * -s` sets the system clock, and ripgrep's `--pre` runs a preprocessor binary
 * on every matched file.
 */
const COMMAND_WRITE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['sort', new Set(['-o', '--output'])],
  ['tree', new Set(['-o'])],
  ['date', new Set(['-s', '--set'])],
  ['rg', new Set(['--pre', '--hostname-bin'])],
]);

/**
 * Read-only commands that start writing once they are handed more positional
 * operands than this: `uniq INPUT OUTPUT` writes OUTPUT, and `hostname NAME`
 * renames the machine.
 */
const OPERAND_WRITE_LIMITS: ReadonlyMap<string, number> = new Map([
  ['uniq', 1],
  ['hostname', 0],
]);

/** `KEY=value` prefix accepted before a wrapped command name. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Guard against `env env env …` recursion. */
const MAX_WRAPPER_DEPTH = 3;

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

/** True when `token` is `flag`, `flag=value`, or a short flag with an attached value. */
function matchesFlag(token: string, flag: string): boolean {
  if (token === flag || token.startsWith(`${flag}=`)) return true;
  const isShort = flag.length === 2 && !flag.startsWith('--');
  return isShort && token.startsWith(flag) && token.length > flag.length;
}

function isPlainSegmentReadOnly(parts: string[]): boolean {
  const [command, ...rest] = parts;
  if (command === undefined) return false;
  const name = basenameOf(command);
  if (name === 'find') {
    return !rest.some((flag) => FIND_WRITE_FLAGS.has(flag));
  }
  if (!READ_ONLY_COMMANDS.has(name)) {
    // Version probes only (`node --version`) stay off-lane: unknown binaries
    // can do anything, so plain-list membership is the sole pass ticket.
    return false;
  }

  const writeFlags = COMMAND_WRITE_FLAGS.get(name);
  if (writeFlags !== undefined) {
    for (const flag of writeFlags) {
      if (rest.some((token) => matchesFlag(token, flag))) return false;
    }
  }

  const operandLimit = OPERAND_WRITE_LIMITS.get(name);
  if (operandLimit !== undefined) {
    const operands = rest.filter((token) => !token.startsWith('-'));
    if (operands.length > operandLimit) return false;
  }

  return true;
}

/**
 * `env` prints the environment when it has no operands, but with operands it
 * execs whatever follows — so classify the wrapped command instead of the
 * wrapper. Flags (`-i`, `-u NAME`, `-S …`, `--chdir=…`) change how that command
 * runs, and modelling each one is not worth the risk: refuse and let the work
 * go to a Job.
 */
function isEnvSegmentReadOnly(parts: string[], depth: number): boolean {
  let index = 1;
  while (index < parts.length) {
    const token = parts[index];
    if (token === undefined || !ENV_ASSIGNMENT.test(token)) break;
    index += 1;
  }
  const wrapped = parts.slice(index);
  const head = wrapped[0];
  if (head === undefined) return true;
  if (head.startsWith('-')) return false;
  return isSegmentReadOnly(wrapped, depth + 1);
}

function isSegmentReadOnly(parts: string[], depth: number): boolean {
  if (depth > MAX_WRAPPER_DEPTH) return false;
  const command = parts[0];
  if (command === undefined) return false;
  if (basenameOf(command) === 'env') return isEnvSegmentReadOnly(parts, depth);
  return command === 'git' ? isGitSegmentReadOnly(parts) : isPlainSegmentReadOnly(parts);
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
    if (!isSegmentReadOnly(parts, 0)) return false;
  }
  return true;
}
