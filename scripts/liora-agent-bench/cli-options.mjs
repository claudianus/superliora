import { randomUUID } from 'node:crypto';

import { DEFAULT_TASK_DIR, SUPPORTED_RUNNERS, SUPPORTED_SUITES } from './constants.mjs';

export function usage() {
  return `Usage: node scripts/liora-agent-bench.mjs [options]

Internal SuperLiora agent benchmark and bounded improvement loop.

Options:
  --help                         Show this help.
  --task-dir <dir>               Task bank directory. Default: ${DEFAULT_TASK_DIR}
  --suite <seed|holdout|guard|system|all>
                                 Task suite. Default: seed
  --runner <fixture|external|ultrawork|provider>
                                 Execution runner. Default: fixture
  --solver-command <command>     Shell command for --runner external.
  --evidence-root <dir>          Evidence output directory.
  --replay-summary <file>        Replay a prior loop summary using its structured rerun argv.
  --loop                         Run bounded improvement loop around the benchmark.
  --max-iterations <n>           Loop iteration cap. Default: 2
  --max-total-ms <ms>            Loop total wall-clock cap. Default: 600000
  --expect-status <status>       Fail if final status differs.
  --keep-workspaces              Keep disposable task workspaces.

Examples:
  node scripts/liora-agent-bench.mjs --suite seed
  node scripts/liora-agent-bench.mjs --suite guard --expect-status QUARANTINED
  node scripts/liora-agent-bench.mjs --loop --max-iterations 2
  node scripts/liora-agent-bench.mjs --runner ultrawork --suite holdout
  node scripts/liora-agent-bench.mjs --runner provider --suite holdout
`;
}

export function createRunId() {
  return new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14) + '-' + randomUUID().slice(0, 8);
}

export function parseArgs(argv) {
  const options = defaultOptions();
  const errors = [];
  const valueOptions = new Set([
    '--task-dir',
    '--suite',
    '--runner',
    '--solver-command',
    '--evidence-root',
    '--replay-summary',
    '--max-iterations',
    '--max-total-ms',
    '--expect-status',
  ]);
  const booleanOptions = new Set(['--help', '--loop', '--keep-workspaces']);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inlineValue] = splitOption(raw);
    if (booleanOptions.has(flag)) {
      if (inlineValue !== undefined) errors.push(`${flag} does not accept a value`);
      else setBooleanOption(options, flag);
      continue;
    }
    if (valueOptions.has(flag)) {
      const next = readValueOption(argv, index, inlineValue);
      index = next.index;
      if (next.error !== undefined) {
        errors.push(next.error);
        continue;
      }
      setValueOption(options, flag, next.value);
      continue;
    }
    errors.push(`Unknown option: ${raw}`);
  }

  errors.push(...validateOptions(options));
  return { errors, options };
}

function defaultOptions() {
  return {
    evidenceRoot: undefined,
    expectStatus: undefined,
    help: false,
    keepWorkspaces: false,
    loop: false,
    maxIterations: 2,
    maxTotalMs: 600_000,
    replaySummary: undefined,
    runner: 'fixture',
    solverCommand: undefined,
    suite: 'seed',
    taskDir: DEFAULT_TASK_DIR,
  };
}

function readValueOption(argv, index, inlineValue) {
  let value = inlineValue;
  let nextIndex = index;
  if (value === undefined) {
    nextIndex += 1;
    value = argv[nextIndex];
  }
  if (value === undefined || value.startsWith('--')) {
    return {
      error: `${argv[index]} requires a value`,
      index: value === undefined ? nextIndex : nextIndex - 1,
      value: undefined,
    };
  }
  return { error: undefined, index: nextIndex, value };
}

function validateOptions(options) {
  const errors = [];
  if (!SUPPORTED_SUITES.has(options.suite)) {
    errors.push(`--suite must be one of: ${[...SUPPORTED_SUITES].join(', ')}`);
  }
  if (!SUPPORTED_RUNNERS.has(options.runner)) {
    errors.push(`--runner must be one of: ${[...SUPPORTED_RUNNERS].join(', ')}`);
  }
  if (options.runner === 'external' && options.solverCommand === undefined) {
    errors.push('--runner external requires --solver-command');
  }
  if (!Number.isInteger(options.maxIterations) || options.maxIterations < 1 || options.maxIterations > 50) {
    errors.push('--max-iterations must be an integer from 1 to 50');
  }
  if (!Number.isInteger(options.maxTotalMs) || options.maxTotalMs < 1_000) {
    errors.push('--max-total-ms must be at least 1000');
  }
  return errors;
}

function splitOption(raw) {
  if (!raw.startsWith('--')) return [raw, undefined];
  const equalsIndex = raw.indexOf('=');
  if (equalsIndex === -1) return [raw, undefined];
  return [raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1)];
}

function setBooleanOption(options, flag) {
  if (flag === '--help') options.help = true;
  if (flag === '--loop') options.loop = true;
  if (flag === '--keep-workspaces') options.keepWorkspaces = true;
}

function setValueOption(options, flag, value) {
  if (flag === '--task-dir') options.taskDir = value;
  if (flag === '--suite') options.suite = value;
  if (flag === '--runner') options.runner = value;
  if (flag === '--solver-command') options.solverCommand = value;
  if (flag === '--evidence-root') options.evidenceRoot = value;
  if (flag === '--replay-summary') options.replaySummary = value;
  if (flag === '--max-iterations') options.maxIterations = Number(value);
  if (flag === '--max-total-ms') options.maxTotalMs = Number(value);
  if (flag === '--expect-status') options.expectStatus = value;
}
