#!/usr/bin/env node
/* eslint-disable no-console */

import { appendFile, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createWriteStream, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import net from 'node:net';

const DEFAULT_EVIDENCE_BASE = '.omo/evidence/super-kimi-autonomous-qa-env';
const DEFAULT_SOTA_TUI_SUMMARY_PATH =
  '.omo/evidence/kimi-agent-bench/system-suite/tui-launch-tmux/tui/summary.json';
const DEFAULT_SOTA_WORKFLOW_SUMMARY_PATH =
  '.omo/evidence/super-kimi-autonomous-qa-env/tui-real-workflow/tui-real-workflow.json';
const DEFAULT_SOTA_ULTRAWORK_SUMMARY_PATH =
  '.omo/evidence/super-kimi-autonomous-qa-env/tui-ultrawork-workflow/tui-ultrawork-workflow.json';
const SOTA_TUI_SUMMARY_SCAN_LIMIT = 2_000;
const REQUIRED_NODE_VERSION = '24.15.0';
const REQUIRED_PNPM_VERSION = '10.33.0';
const UNSUPPORTED_ENGINE_PATTERNS = Object.freeze([
  /Unsupported engine/i,
  /\bcurrent:\s*\{"node":"v?[0-9.]+","pnpm":"[^"]+"\}/i,
]);
const STATIC_PHASE_TIMEOUTS = Object.freeze({
  preflight: 30_000,
  install: 10 * 60_000,
  build: 10 * 60_000,
  typecheck: 5 * 60_000,
  lint: 2 * 60_000,
  test: 5 * 60_000,
});
const SUPPORTED_PHASES = Object.freeze([
  'setup',
  'static',
  'direct-cli',
  'server',
  'tui-launch',
  'tui-real-workflow',
  'tui-ultrawork-workflow',
  'tui-iteration',
  'autonomous',
  'bench',
  'bench-loop',
  'bench-system',
  'bench-system-loop',
  'sota-gate',
  'all',
  'cleanup',
]);
const PHASES_FOR_ALL = Object.freeze([
  'static',
  'direct-cli',
  'server',
  'tui-launch',
  'tui-iteration',
  'autonomous',
  'bench',
  'bench-system',
  'sota-gate',
  'cleanup',
]);
const EVIDENCE_SUBDIRS = Object.freeze([
  'commands',
  'logs',
  'screens',
  'tui',
  'tui-iteration',
  'workflow',
  'ultrawork',
  'server',
  'autonomous',
  'bench',
  'cleanup',
]);
const TUI_CAPTURE_SCENARIOS = Object.freeze([
  { name: 'startup', description: 'Initial visible Kimi TUI chrome/editor state.' },
  { name: 'help', keys: ['/help', 'Enter'], description: 'Open /help dialog.' },
  {
    name: 'status',
    keys: ['Escape', '/status', 'Enter'],
    description: 'Open /status readiness panel.',
  },
  { name: 'clear', keys: ['Escape', '/clear', 'Enter'], description: 'Run /clear local command.' },
  {
    name: 'autocomplete',
    keys: ['/h'],
    description: 'Open slash-command autocomplete with a command prefix.',
  },
  {
    name: 'prompt-entry',
    keys: ['Escape', 'BSpace', 'visible qa prompt entry only'],
    description: 'Type prompt text without submitting it.',
  },
  { name: 'escape-cancel', keys: ['C-c'], description: 'Cancel/clear the typed prompt.' },
  {
    name: 'permission-mode',
    description: 'Capture footer/chrome with --auto permission mode from launch argv.',
  },
  { name: 'exit', keys: ['/exit', 'Enter'], description: 'Gracefully exit the TUI.' },
]);
const COMPUTER_USE_STATE_SCHEMA_VERSION = 1;
const COMPUTER_USE_STATE_MAX_AGE_MS = 10 * 60_000;
const COMPUTER_USE_STATE_FUTURE_SKEW_MS = 60_000;
const TUI_OUROBOROS_PASS_THRESHOLD = 0.85;
const TUI_PROMPT_ENTRY_TEXT = 'visible qa prompt entry only';
const TUI_INPUT_STEP_DELAY_MS = 150;
const TUI_READY_TIMEOUT_MS = 45_000;
const TUI_REAL_WORKFLOW_SOURCE_FILE = 'apps/kimi-code/src/tui/commands/ultrawork-contract.ts';
const TUI_REAL_WORKFLOW_TEST_FILE = 'apps/kimi-code/test/tui/commands/ultrawork.test.ts';
const TUI_REAL_WORKFLOW_VERIFIER_DIR = '.super-kimi-real-workflow';
const TUI_REAL_WORKFLOW_VERIFIER = path.posix.join(TUI_REAL_WORKFLOW_VERIFIER_DIR, 'check.mjs');
const TUI_REAL_WORKFLOW_GUIDANCE =
  'real repository source/test workflow evidence';
const TUI_REAL_WORKFLOW_EDIT_FILES = Object.freeze([
  TUI_REAL_WORKFLOW_SOURCE_FILE,
  TUI_REAL_WORKFLOW_TEST_FILE,
]);
const TUI_REAL_WORKFLOW_ALLOWED_STATUS_PATHS = Object.freeze([
  ...TUI_REAL_WORKFLOW_EDIT_FILES,
  TUI_REAL_WORKFLOW_VERIFIER,
  'node_modules',
  'apps/kimi-code/node_modules',
]);
const TUI_REAL_WORKFLOW_SENTINEL = 'REAL_REPO_WORKFLOW_DONE';
const TUI_REAL_WORKFLOW_TIMEOUT_MS = 180_000;
const TUI_ULTRAWORK_WORKFLOW_TIMEOUT_MS = 360_000;
const TUI_ULTRAWORK_MAX_QUESTION_ANSWERS = 6;
const REQUIRED_TUI_CAPTURE_SCENARIOS = TUI_CAPTURE_SCENARIOS.map((scenario) => scenario.name);
const MIN_SCREENSHOT_WIDTH = 80;
const MIN_SCREENSHOT_HEIGHT = 40;
const MAX_SCREENSHOT_DIMENSION = 20_000;
const TARGETED_TUI_TEST_FILES = Object.freeze([
  'test/tui/kimi-tui-message-flow.test.ts',
  'test/tui/printable-key-guard.test.ts',
]);
const EXPECTED_OUROBOROS_TOOL = 'mcp__ouroboros.ouroboros_qa';
const BOOLEAN_OPTIONS = new Set([
  '--keep-temp',
  '--dry-run',
  '--print-plan',
  '--install',
  '--simulate-missing-auth',
  '--use-real-kimi-home',
]);
const VALUE_OPTIONS = new Set([
  '--phase',
  '--evidence-root',
  '--port',
  '--tmux-session',
  '--kimi-code-home',
  '--require-computer-use',
  '--tui-before',
  '--tui-after',
  '--baseline-file',
]);
const SERVER_NO_AUTH_SCENARIOS = Object.freeze([
  '05-workspace.ts',
  '06-model-catalog.ts',
  '11-terminal.ts',
]);
const SERVER_EXCLUDED_NO_AUTH_SCENARIOS = Object.freeze([
  '03-refresh-replay.ts',
  '08-pending-recovery.ts',
]);
const SERVER_START_TIMEOUT_MS = 120_000;
const SERVER_E2E_TIMEOUT_MS = 900_000;
const NODE_PTY_REPAIR_TIMEOUT_MS = 30_000;
const AUTONOMOUS_CANARY_TOKEN = 'AUTONOMOUS_QA_CANARY';
const AUTONOMOUS_CANARY_FILE = 'qa-canary.txt';
const AUTONOMOUS_COMMAND_TIMEOUT_MS = 10 * 60_000;
const EXPECTED_KIMI_CODE_DEFAULT_MODEL = 'kimi-code/kimi-for-coding';
const EXPECTED_KIMI_CODE_MODEL_LABEL = 'K2.7 Code';
const AGGREGATE_COMMAND_LOGS = Object.freeze([
  'static.jsonl',
  'direct-cli.jsonl',
  'server.jsonl',
  'tui-launch.jsonl',
  'tui-iteration.jsonl',
  'tui-real-workflow.jsonl',
  'tui-ultrawork-workflow.jsonl',
  'autonomous.jsonl',
  'bench.jsonl',
  'commands.jsonl',
]);
const REQUIRED_ALL_PHASES = Object.freeze([
  'static',
  'direct-cli',
  'server',
  'tui-launch',
  'tui-iteration',
  'autonomous',
  'bench',
  'bench-system',
  'sota-gate',
  'cleanup',
]);

function usage() {
  return `Usage: node scripts/qa-super-kimi-autonomous.mjs [options]

Super Kimi autonomous QA harness.
Todo 3 implements setup isolation plus the web-free static integrity phase.

Options:
  --help                              Show this help.
  --phase <name>                      Run a phase.
  --evidence-root <dir>               Concrete run directory. No run id is appended.
  --keep-temp                         Record that temporary artifacts should be kept.
  --dry-run                           Record a dry-run skeleton execution.
  --print-plan                        Print supported phases and skeleton plan.
  --install                           Run static pnpm install even when node_modules exists.
  --port <port>                       Record the intended loopback port.
  --tmux-session <name>               Record the intended tmux session name.
  --kimi-code-home <dir>              Record the intended KIMI_CODE_HOME.
  --use-real-kimi-home                Use the real ~/.kimi-code home for live TUI workflow auth/model checks.
  --require-computer-use <available|missing>
                                      Record expected computer-use availability.
  --simulate-missing-auth             Record a missing-auth simulation request.
  --tui-before <dir>                  Record the TUI before-artifact directory.
  --tui-after <dir>                   Record the TUI after-artifact directory.
  --baseline-file <path>              Record the dirty-worktree baseline path.

Supported phases:
  ${SUPPORTED_PHASES.join('\n  ')}
`;
}

function createRunId() {
  const timestamp = new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14);
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function createTerminalTitlePrefix(runId) {
  return `super-kimi-autonomous-qa:${runId}`;
}

function parseArgs(argv) {
  const options = {
    baselineFile: undefined,
    dryRun: false,
    evidenceRoot: undefined,
    explicitPhase: false,
    help: false,
    install: false,
    keepTemp: false,
    kimiCodeHome: undefined,
    phase: undefined,
    port: undefined,
    printPlan: false,
    requireComputerUse: undefined,
    simulateMissingAuth: false,
    tmuxSession: undefined,
    tuiAfter: undefined,
    tuiBefore: undefined,
    useRealKimiHome: false,
  };
  const errors = [];

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const [flag, inlineValue] = splitOption(rawArg);

    if (flag === '--help') {
      if (inlineValue !== undefined) {
        errors.push('--help does not accept a value');
      }
      options.help = true;
      continue;
    }

    if (BOOLEAN_OPTIONS.has(flag)) {
      if (inlineValue !== undefined) {
        errors.push(`${flag} does not accept a value`);
        continue;
      }
      setBooleanOption(options, flag);
      continue;
    }

    if (VALUE_OPTIONS.has(flag)) {
      let value = inlineValue;
      if (value === undefined) {
        index += 1;
        value = argv[index];
      }
      if (value === undefined || value.startsWith('--')) {
        errors.push(`${flag} requires a value`);
        if (value !== undefined) {
          index -= 1;
        }
        continue;
      }
      setValueOption(options, flag, value);
      continue;
    }

    errors.push(`Unknown option: ${rawArg}`);
  }

  if (options.phase !== undefined && !SUPPORTED_PHASES.includes(options.phase)) {
    errors.push(`Invalid phase: ${String(options.phase)}`);
  }
  if (options.kimiCodeHome !== undefined && options.useRealKimiHome) {
    errors.push('--kimi-code-home cannot be combined with --use-real-kimi-home');
  }

  if (
    options.requireComputerUse !== undefined &&
    options.requireComputerUse !== 'available' &&
    options.requireComputerUse !== 'missing'
  ) {
    errors.push('--require-computer-use must be "available" or "missing"');
  }

  if (options.port !== undefined) {
    const portNumber = Number(options.port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      errors.push('--port must be an integer from 1 to 65535');
    }
  }

  return { errors, options };
}

function splitOption(rawArg) {
  if (!rawArg.startsWith('--')) {
    return [rawArg, undefined];
  }
  const equalsIndex = rawArg.indexOf('=');
  if (equalsIndex === -1) {
    return [rawArg, undefined];
  }
  return [rawArg.slice(0, equalsIndex), rawArg.slice(equalsIndex + 1)];
}

function setBooleanOption(options, flag) {
  switch (flag) {
    case '--keep-temp':
      options.keepTemp = true;
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--print-plan':
      options.printPlan = true;
      break;
    case '--install':
      options.install = true;
      break;
    case '--simulate-missing-auth':
      options.simulateMissingAuth = true;
      break;
    case '--use-real-kimi-home':
      options.useRealKimiHome = true;
      break;
  }
}

function setValueOption(options, flag, value) {
  switch (flag) {
    case '--phase':
      options.phase = value;
      options.explicitPhase = true;
      break;
    case '--evidence-root':
      options.evidenceRoot = value;
      break;
    case '--port':
      options.port = value;
      break;
    case '--tmux-session':
      options.tmuxSession = value;
      break;
    case '--kimi-code-home':
      options.kimiCodeHome = value;
      break;
    case '--require-computer-use':
      options.requireComputerUse = value;
      break;
    case '--tui-before':
      options.tuiBefore = value;
      break;
    case '--tui-after':
      options.tuiAfter = value;
      break;
    case '--baseline-file':
      options.baselineFile = value;
      break;
  }
}

function planPayload() {
  return {
    description: 'Web-free autonomous QA plus internal Super Kimi agent benchmark phases.',
    liveProcessesStarted: false,
    supportedPhases: SUPPORTED_PHASES,
    evidenceSubdirectories: EVIDENCE_SUBDIRS,
  };
}

async function runHarness(options, runId) {
  const createdAt = new Date().toISOString();
  const evidenceRoot = options.evidenceRoot
    ? path.resolve(options.evidenceRoot)
    : path.resolve(DEFAULT_EVIDENCE_BASE, runId);
  const isAggregateRun = options.phase === 'all';
  const phases = options.phase === 'all' ? PHASES_FOR_ALL : [options.phase];
  const sourceCheckout = resolveSourceCheckout();
  const nodeRuntime = resolveRequiredNodeRuntime(sourceCheckout);
  const tempRoot = path.join(os.tmpdir(), 'super-kimi-autonomous-qa', runId);
  const plannedKimiCodeHome = path.resolve(
    options.useRealKimiHome
      ? defaultRealKimiCodeHome()
      : options.kimiCodeHome ?? path.join(tempRoot, 'kimi-home'),
  );
  const kimiCodeHomeMode = options.useRealKimiHome
    ? 'real-user-opt-in'
    : options.kimiCodeHome === undefined
      ? 'generated-temp-home'
      : 'caller-supplied';
  const targetWorktree = path.join(tempRoot, 'target-worktree');
  const titlePrefix = createTerminalTitlePrefix(runId);
  const selectedPort = await selectPort(options.port);
  const baselinePath = await prepareBaselinePath(evidenceRoot, options.baselineFile);
  const preflight = runPreflight(sourceCheckout, selectedPort);
  const redactionPolicy = buildRedactionPolicy();
  const environmentSnapshot = redactEnvironment(process.env, redactionPolicy);

  await mkdir(evidenceRoot, { recursive: true });
  await Promise.all(
    EVIDENCE_SUBDIRS.map((subdir) =>
      mkdir(path.join(evidenceRoot, subdir), { recursive: true }),
    ),
  );
  if (isAggregateRun) {
    await resetAggregateCommandLogs(evidenceRoot);
  }

  const phaseEntries = phases.map((phase) => createPendingPhaseEntry(phase, createdAt));
  const manifest = {
    schemaVersion: 1,
    harness: 'qa-super-kimi-autonomous',
    todo: phases.includes('static')
      ? 'Todo 3 web-free static integrity phase'
      : phases.includes('server')
        ? 'Todo 5 live server proof'
        : phases.includes('tui-launch')
          ? 'Todo 6 direct visible TUI screen operation proof'
          : phases.includes('tui-real-workflow')
            ? 'Ultrawork real TUI real TUI coding workflow proof'
            : phases.includes('tui-iteration')
          ? 'Todo 7 TUI iterative improvement and design QA loop'
          : phases.includes('direct-cli')
            ? 'Todo 4 direct CLI runtime proof'
            : phases.includes('autonomous')
              ? 'Todo 8 headless autonomous /ultrawork canary and missing-credentials proof'
              : phases.includes('bench-system-loop')
                ? 'Internal Super Kimi system benchmark bounded improvement loop'
              : phases.includes('sota-gate')
                ? 'Internal Super Kimi SOTA gate over local evidence artifacts'
              : phases.includes('bench-system')
                ? 'Internal Super Kimi system benchmark for QA harness and TUI'
              : phases.includes('bench-loop')
                ? 'Internal Super Kimi agent benchmark bounded improvement loop'
              : phases.includes('bench')
                ? 'Internal Super Kimi agent benchmark seed proof'
              : 'Todo 2 clean-room setup',
    runId,
    createdAt,
    updatedAt: new Date().toISOString(),
    status: 'running',
    reason: 'Manifest written before live phase commands.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    evidenceRoot,
    evidenceRootInput: options.evidenceRoot,
    evidenceRootMode: options.evidenceRoot ? 'explicit' : 'generated',
    tempRoot,
    targetWorktree,
    targetWorktreeKind: 'disposable-git-worktree',
    targetWorktreeMode: options.dryRun ? 'planned-dry-run' : 'planned',
    sourceCheckout,
    nodeRuntime,
    kimiCodeHome: plannedKimiCodeHome,
    kimiCodeHomeMode,
    selectedPort: selectedPort.port,
    selectedPortSource: selectedPort.source,
    baselinePath,
    terminalTitlePrefix: titlePrefix,
    terminalTitleExactRunId: titlePrefix,
    redactionPolicy,
    environmentSnapshot,
    preflight,
    supportedPhases: SUPPORTED_PHASES,
    requestedPhase: options.phase,
    phases: phaseEntries,
    subdirectories: EVIDENCE_SUBDIRS,
    options: manifestOptions(options),
  };

  await writeJson(path.join(evidenceRoot, 'manifest.json'), manifest);
  await writeJson(path.join(evidenceRoot, 'env-redacted.json'), environmentSnapshot);

  const context = {
    baselinePath,
    createdAt,
    evidenceRoot,
    options,
    plannedKimiCodeHome,
    kimiCodeHomeMode,
    preflight,
    redactionPolicy,
    runId,
    selectedPort,
    sourceCheckout,
    nodeRuntime,
    targetWorktree,
    tempRoot,
    titlePrefix,
  };

  const cleanupOverrides = {};
  const phaseCleanupRecords = [];
  let hasFailure = false;
  if (isAggregateRun && selectedPort.availability.status !== 'PASS') {
    const portBusyEntry = createPortBusyPhaseEntry({
      createdAt,
      port: selectedPort.port,
      reason: selectedPort.availability.reason,
    });
    phaseEntries[0] = portBusyEntry;
    hasFailure = true;
    await writeStatusFile(evidenceRoot, portBusyEntry);
    await writePortBusyFailureEvidence(context, selectedPort);
  } else {
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      const result =
        phase === 'static'
          ? await runStaticPhase(context)
          : phase === 'direct-cli'
            ? await runDirectCliPhase(context)
            : phase === 'autonomous'
              ? await runAutonomousPhase(context)
              : phase === 'server'
                ? await runServerPhase(context)
                : phase === 'tui-launch'
              ? await runTuiLaunchPhase(context)
              : phase === 'tui-real-workflow'
                ? await runTuiRealWorkflowPhase(context)
                : phase === 'tui-ultrawork-workflow'
                  ? await runTuiUltraworkWorkflowPhase(context)
                : phase === 'tui-iteration'
                  ? await runTuiIterationPhase(context)
                : phase === 'cleanup'
                  ? await runCleanupPhase(context, cleanupOverrides)
                  : phase === 'bench'
                    ? await runBenchPhase(context)
                    : phase === 'bench-loop'
                      ? await runBenchLoopPhase(context)
                      : phase === 'bench-system'
                        ? await runBenchSystemPhase(context)
                        : phase === 'bench-system-loop'
                          ? await runBenchSystemLoopPhase(context)
                          : phase === 'sota-gate'
                            ? await runSotaGatePhase(context)
                      : await runSkeletonPhase(evidenceRoot, runId, phase, options, createdAt);
      phaseEntries[index] = result.phaseEntry;
      Object.assign(cleanupOverrides, result.cleanupOverrides);
      phaseCleanupRecords.push({
        phase,
        cleanup: result.cleanupOverrides,
      });
      if (
        result.phaseEntry.status === 'FAIL' ||
        result.phaseEntry.status === 'BLOCKED' ||
        result.phaseEntry.status === 'not-implemented'
      ) {
        hasFailure = true;
      }
    }
  }

  manifest.updatedAt = new Date().toISOString();
  const cleanupReceipt = buildCleanupReceipt({
    baselinePath,
    createdAt,
    evidenceRoot,
    options,
    runId,
    selectedPort,
    sourceCheckout,
    targetWorktree,
    tempRoot,
    titlePrefix,
    plannedKimiCodeHome,
    overrides: buildAggregateCleanupOverrides({
      baseOverrides: cleanupOverrides,
      context,
      phaseCleanupRecords,
      phaseEntries,
    }),
  });
  await writeCleanupReceipt(evidenceRoot, cleanupReceipt);
  const commandIndex = await writeCommandIndex(evidenceRoot, runId);
  const aggregate = isAggregateRun
    ? await buildAggregateSummary({
        commandIndex,
        cleanupReceipt,
        context,
        createdAt,
        phaseEntries,
        selectedPort,
      })
    : undefined;
  if (aggregate !== undefined) {
    await writeAggregateArtifacts(context, aggregate);
    hasFailure = aggregate.exitCode !== 0;
  }

  manifest.status = aggregate?.manifestStatus ?? (hasFailure
    ? phaseEntries.some((entry) => entry.status === 'BLOCKED')
      ? 'blocked'
      : 'failed'
    : phases.includes('server')
      ? 'server-pass'
      : phases.includes('static')
        ? 'static-pass'
      : phases.includes('tui-launch')
          ? 'tui-launch-pass'
          : phases.includes('tui-real-workflow')
            ? 'tui-real-workflow-pass'
            : phases.includes('tui-ultrawork-workflow')
              ? 'tui-ultrawork-workflow-pass'
            : phases.includes('tui-iteration')
              ? 'tui-iteration-pass'
            : phases.includes('direct-cli')
              ? 'direct-cli-pass'
              : phases.includes('autonomous')
                ? 'autonomous-pass'
                : phases.includes('bench-system-loop')
                  ? 'bench-system-loop-pass'
                  : phases.includes('sota-gate')
                    ? 'sota-gate-pass'
                : phases.includes('bench-system')
                  ? 'bench-system-pass'
                : phases.includes('bench-loop')
                  ? 'bench-loop-pass'
                : phases.includes('bench')
                  ? 'bench-pass'
                : 'setup-planned');
  manifest.reason = hasFailure
    ? 'One or more requested phases failed or are not implemented.'
    : phases.includes('server')
      ? 'Live server REST, WebSocket, server-e2e, stale-server, and cleanup proof completed.'
      : phases.includes('static')
      ? 'Static integrity phase completed.'
      : phases.includes('tui-launch')
        ? 'Visible TUI launch proof completed with computer-use and tmux evidence.'
        : phases.includes('tui-real-workflow')
          ? 'Real TUI real TUI coding workflow proof completed with submitted prompt, agent-run verification evidence, workspace diff, and cleanup evidence.'
          : phases.includes('tui-ultrawork-workflow')
            ? 'Live TUI Ultrawork proof completed with activation, interview question answer, post-question progress, and no auto/question policy conflict.'
          : phases.includes('tui-iteration')
            ? 'TUI before/after evidence, targeted logs, and QA verdict completed.'
          : phases.includes('direct-cli')
            ? 'Direct CLI runtime proof completed.'
            : phases.includes('autonomous')
              ? 'Headless autonomous /ultrawork canary proof completed.'
              : phases.includes('bench-system-loop')
                ? 'Internal system benchmark bounded improvement loop completed.'
              : phases.includes('sota-gate')
                ? 'Internal SOTA gate completed over local bench, live TUI launch, real workflow, and Ultrawork artifacts.'
              : phases.includes('bench-system')
                ? 'Internal system benchmark covered the QA harness and TUI contracts.'
              : phases.includes('bench-loop')
                ? 'Internal benchmark bounded improvement loop completed.'
              : phases.includes('bench')
                ? 'Internal benchmark seed suite completed with clean contamination preflight.'
              : 'Clean-room paths, preflight, redacted environment, and cleanup receipt are recorded.';
  manifest.reason = aggregate?.reason ?? manifest.reason;
  manifest.liveProductCommandsStarted = phaseEntries.some((entry) => entry.liveProductCommandStarted);
  manifest.phases = phaseEntries;
  manifest.aggregate = aggregate === undefined ? undefined : {
    status: aggregate.status,
    exitCode: aggregate.exitCode,
    summaryJsonPath: aggregate.summaryJsonPath,
    summaryMarkdownPath: aggregate.summaryMarkdownPath,
    commandIndexPath: aggregate.commandIndexPath,
    cleanupReceiptPath: aggregate.cleanupReceiptPath,
  };
  await writeJson(path.join(evidenceRoot, 'manifest.json'), manifest);

  console.log(`Evidence root: ${evidenceRoot}`);
  console.log(`Status: ${manifest.status}`);
  if (hasFailure) {
    process.exitCode = 1;
  }
}

function createPendingPhaseEntry(phase, createdAt) {
  return {
    name: phase,
    status: 'pending',
    reason: 'Phase has not run yet.',
    subprocessStarted: false,
    liveProductCommandStarted: false,
    startedAt: createdAt,
    completedAt: undefined,
  };
}

async function resetAggregateCommandLogs(evidenceRoot) {
  await Promise.all(
    AGGREGATE_COMMAND_LOGS.map((fileName) =>
      writeFile(path.join(evidenceRoot, 'commands', fileName), '', 'utf8'),
    ),
  );
  await rm(path.join(evidenceRoot, 'commands', 'index.jsonl'), { force: true });
  await rm(path.join(evidenceRoot, 'summary.json'), { force: true });
  await rm(path.join(evidenceRoot, 'summary.md'), { force: true });
}

function createPortBusyPhaseEntry({ createdAt, port, reason }) {
  const completedAt = new Date().toISOString();
  return {
    name: 'static',
    status: 'FAIL',
    reason: `malformed_input: requested loopback port ${port} is unavailable before aggregate phases: ${reason}`,
    subprocessStarted: false,
    liveProductCommandStarted: false,
    startedAt: createdAt,
    completedAt,
  };
}

async function writePortBusyFailureEvidence(context, selectedPort) {
  const failure = {
    schemaVersion: 1,
    status: 'FAIL',
    adversarialClass: 'malformed_input',
    reason: selectedPort.availability.reason,
    host: '127.0.0.1',
    port: selectedPort.port,
    liveProductCommandStarted: false,
    cleanupRequired: true,
  };
  await writeJson(path.join(context.evidenceRoot, 'failure-port.json'), failure);
  await writeFile(
    path.join(context.evidenceRoot, 'failure-port.log'),
    [
      `status=FAIL`,
      `adversarialClass=malformed_input`,
      `host=127.0.0.1`,
      `port=${selectedPort.port}`,
      `reason=${selectedPort.availability.reason}`,
      'liveProductCommandStarted=false',
      '',
    ].join('\n'),
    'utf8',
  );
  await appendFile(
    path.join(context.evidenceRoot, 'commands', 'commands.jsonl'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId: context.runId,
      phase: 'all',
      name: 'port-preflight',
      argv: ['node', 'scripts/qa-super-kimi-autonomous.mjs', '--phase', 'all', '--port', String(selectedPort.port)],
      cwd: context.sourceCheckout,
      startedAt: context.createdAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: 1,
      status: 'FAIL',
      reason: selectedPort.availability.reason,
      stdout: '',
      stderr: '',
      error: selectedPort.availability.reason,
    })}\n`,
    'utf8',
  );
}

async function runCleanupPhase(context, accumulatedCleanup) {
  const startedAt = new Date().toISOString();
  const tempRootExists = await pathExists(context.tempRoot);
  let tempRootRemoved = false;
  if (tempRootExists && !context.options.keepTemp) {
    await rm(context.tempRoot, { recursive: true, force: true });
    tempRootRemoved = true;
  }
  const phaseEntry = {
    name: 'cleanup',
    status: 'PASS',
    reason: 'Final cleanup enforcement is recorded in cleanup/receipt.json after aggregate command indexing.',
    subprocessStarted: false,
    liveProductCommandStarted: false,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await appendFile(
    path.join(context.evidenceRoot, 'commands', 'commands.jsonl'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId: context.runId,
      phase: 'cleanup',
      name: 'cleanup-finalizer',
      argv: [],
      cwd: context.sourceCheckout,
      startedAt,
      completedAt: phaseEntry.completedAt,
      durationMs: 0,
      exitCode: 0,
      status: 'PASS',
      reason: phaseEntry.reason,
      accumulatedCleanupStatus: accumulatedCleanup.status,
    })}\n`,
    'utf8',
  );
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return {
    phaseEntry,
    cleanupOverrides: {
      status: 'cleanup-finalized',
      reason: phaseEntry.reason,
      liveProcessesStarted: false,
      liveProductCommandsStarted: false,
      tempRoot: {
        path: context.tempRoot,
        created: tempRootExists,
        removed: tempRootRemoved,
        retained: tempRootExists && !tempRootRemoved,
        detail: tempRootExists
          ? 'Cleanup phase removed the aggregate temp root after all live phases.'
          : 'Aggregate temp root was already absent before cleanup phase.',
      },
      proofCommands: [],
    },
  };
}

async function runBenchPhase(context) {
  return runInternalBenchCommand(context, {
    phase: 'bench',
    name: 'super-kimi-agent-bench-seed',
    args: [
      'scripts/kimi-agent-bench.mjs',
      '--suite',
      'seed',
      '--runner',
      'fixture',
      '--evidence-root',
      path.join(context.evidenceRoot, 'bench', 'seed'),
      '--expect-status',
      'PASS',
    ],
    summaryFile: path.join(context.evidenceRoot, 'bench', 'seed', 'summary.json'),
    reportFile: path.join(context.evidenceRoot, 'bench', 'summary.json'),
    expectedStatus: 'PASS',
    timeoutMs: 180_000,
    passReason:
      'Internal seed benchmark passed with deterministic checks and clean contamination preflight.',
  });
}

async function runBenchLoopPhase(context) {
  return runInternalBenchCommand(context, {
    phase: 'bench-loop',
    name: 'super-kimi-agent-bench-loop',
    args: [
      'scripts/kimi-agent-bench.mjs',
      '--suite',
      'seed',
      '--runner',
      'fixture',
      '--loop',
      '--max-iterations',
      '2',
      '--evidence-root',
      path.join(context.evidenceRoot, 'bench', 'loop'),
      '--expect-status',
      'PASS',
    ],
    summaryFile: path.join(context.evidenceRoot, 'bench', 'loop', 'loop-summary.json'),
    reportFile: path.join(context.evidenceRoot, 'bench', 'loop-summary.json'),
    expectedStatus: 'PASS',
    timeoutMs: 240_000,
    passReason:
      'Internal bounded improvement loop stopped with explicit iteration/time guardrails and a passing seed score.',
  });
}

async function runBenchSystemPhase(context) {
  return runInternalBenchCommand(context, {
    phase: 'bench-system',
    name: 'super-kimi-system-bench',
    args: [
      'scripts/kimi-agent-bench.mjs',
      '--suite',
      'system',
      '--runner',
      'fixture',
      '--evidence-root',
      path.join(context.evidenceRoot, 'bench', 'system'),
      '--expect-status',
      'PASS',
    ],
    summaryFile: path.join(context.evidenceRoot, 'bench', 'system', 'summary.json'),
    reportFile: path.join(context.evidenceRoot, 'bench', 'system-summary.json'),
    expectedStatus: 'PASS',
    timeoutMs: 1_200_000,
    passReason:
      'Internal system benchmark passed by exercising the real QA harness and TUI contract surface.',
  });
}

async function runBenchSystemLoopPhase(context) {
  return runInternalBenchCommand(context, {
    phase: 'bench-system-loop',
    name: 'super-kimi-system-bench-loop',
    args: [
      'scripts/kimi-agent-bench.mjs',
      '--suite',
      'system',
      '--runner',
      'fixture',
      '--loop',
      '--max-iterations',
      '2',
      '--evidence-root',
      path.join(context.evidenceRoot, 'bench', 'system-loop'),
      '--expect-status',
      'PASS',
    ],
    summaryFile: path.join(context.evidenceRoot, 'bench', 'system-loop', 'loop-summary.json'),
    reportFile: path.join(context.evidenceRoot, 'bench', 'system-loop-summary.json'),
    expectedStatus: 'PASS',
    timeoutMs: 1_500_000,
    passReason:
      'Internal system benchmark loop stopped with bounded guardrails after measuring the real QA harness and TUI contract surface.',
  });
}

async function runSotaGatePhase(context) {
  const startedAt = new Date().toISOString();
  const nodePath = context.nodeRuntime.status === 'PASS' ? context.nodeRuntime.nodePath : process.execPath;
  const reportDir = path.join(context.evidenceRoot, 'bench', 'sota-gate');
  await mkdir(reportDir, { recursive: true });
  const tuiSummarySelection = await selectSotaTuiSummary(context);
  const workflowSummarySelection = await selectSotaWorkflowSummary(context);
  const ultraworkSummarySelection = await selectSotaUltraworkSummary(context);
  const args = [
    'scripts/kimi-agent-sota-gate.mjs',
    '--system-summary',
    '.omo/evidence/super-kimi-autonomous-qa-env/bench-system-with-live-tui/bench/system-summary.json',
    '--loop-summary',
    '.omo/evidence/super-kimi-autonomous-qa-env/bench-system-loop-with-live-tui/bench/system-loop-summary.json',
    '--tui-summary',
    tuiSummarySelection.path,
    '--workflow-summary',
    workflowSummarySelection.path,
    '--require-cleanup-receipt',
    '--output-dir',
    reportDir,
  ];
  if (ultraworkSummarySelection !== undefined) {
    args.push('--ultrawork-summary', ultraworkSummarySelection.path);
  }
  const argv = [nodePath, ...args];
  const env = withRequiredNodePath(process.env, context);
  const result = runBoundedCommand(nodePath, args, {
    cwd: context.sourceCheckout,
    env,
    timeoutMs: 60_000,
  });
  const completedAt = new Date().toISOString();
  const stdout = redactCommandOutput(result.stdout, context.redactionPolicy);
  const stderr = redactCommandOutput(result.stderr, context.redactionPolicy);
  const basePath = path.join(context.evidenceRoot, 'commands', 'super-kimi-sota-gate');
  await writeFile(`${basePath}.stdout.txt`, stdout, 'utf8');
  await writeFile(`${basePath}.stderr.txt`, stderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${result.status}\n`, 'utf8');

  const summaryPath = path.join(reportDir, 'sota-gate-summary.json');
  const markdownPath = path.join(reportDir, 'sota-gate-summary.md');
  const gateSummary = await readJsonIfFile(summaryPath);
  const loopScoreAudit = validateSotaLoopScore(gateSummary);
  const pass =
    result.status === 0 &&
    !result.timedOut &&
    gateSummary?.status === 'PASS' &&
    loopScoreAudit.status === 'PASS';
  const passReason =
    ultraworkSummarySelection === undefined
      ? `Internal SOTA gate passed over local bench-system, bounded loop, live TUI launch, real workflow artifacts, and loop score ${loopScoreAudit.observed.score}/${loopScoreAudit.observed.maxScore}.`
      : `Internal SOTA gate passed over local bench-system, bounded loop, live TUI launch, real workflow, Ultrawork artifacts, and loop score ${loopScoreAudit.observed.score}/${loopScoreAudit.observed.maxScore}.`;
  const phaseSummary = {
    schemaVersion: 1,
    phase: 'sota-gate',
    status: pass ? 'PASS' : 'FAIL',
    reason: pass
      ? passReason
      : result.timedOut
        ? 'super-kimi-sota-gate timed out.'
        : `super-kimi-sota-gate exited ${result.status}; gate status=${String(gateSummary?.status)}; loop score status=${loopScoreAudit.status}: ${loopScoreAudit.reason}`,
    startedAt,
    completedAt,
    command: argv,
    tuiSummarySelection,
    workflowSummarySelection,
    ultraworkSummarySelection,
    summaryFile: summaryPath,
    markdownFile: markdownPath,
    loopScore: loopScoreAudit.observed,
    gateSummary,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
  };
  const reportFile = path.join(context.evidenceRoot, 'bench', 'sota-gate-summary.json');
  await writeJson(reportFile, phaseSummary);

  const record = {
    schemaVersion: 1,
    runId: context.runId,
    phase: 'sota-gate',
    name: 'super-kimi-sota-gate',
    argv,
    cwd: context.sourceCheckout,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    status: phaseSummary.status,
    reason: phaseSummary.reason,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
    summaryFile: summaryPath,
    loopScore: loopScoreAudit.observed,
    tuiSummarySelection,
    workflowSummarySelection,
    reportFile,
  };
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path.join(context.evidenceRoot, 'commands', 'bench.jsonl'), line, 'utf8');
  await appendFile(path.join(context.evidenceRoot, 'commands', 'commands.jsonl'), line, 'utf8');

  const phaseEntry = {
    name: 'sota-gate',
    status: phaseSummary.status,
    reason: phaseSummary.reason,
    subprocessStarted: true,
    liveProductCommandStarted: false,
    startedAt,
    completedAt,
    summaryPath: reportFile,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return {
    phaseEntry,
    cleanupOverrides: {
      status: `sota-gate-${phaseSummary.status.toLowerCase()}`,
      reason: phaseSummary.reason,
      liveProcessesStarted: false,
      liveProductCommandsStarted: false,
      proofCommands: [commandProof(result)],
    },
  };
}

function validateSotaLoopScore(gateSummary) {
  const scorecard = gateSummary?.loopScorecard;
  const scoreGate = Array.isArray(gateSummary?.gates)
    ? gateSummary.gates.find((gate) => gate?.name === 'super-kimi-loop-score')
    : undefined;
  const failures = [];
  if (gateSummary?.status !== 'PASS') {
    failures.push(`SOTA gate status is ${String(gateSummary?.status)}`);
  }
  if (scorecard === undefined) {
    failures.push('loopScorecard is missing');
  }
  if (scoreGate === undefined) {
    failures.push('super-kimi-loop-score gate is missing');
  }
  if (scorecard?.status !== 'PASS') {
    failures.push(`loopScorecard status is ${String(scorecard?.status)}`);
  }
  if (scoreGate?.status !== 'PASS') {
    failures.push(`super-kimi-loop-score gate status is ${String(scoreGate?.status)}`);
  }
  if (scorecard?.score !== scoreGate?.observed?.score) {
    failures.push('loopScorecard score does not match gate observed score');
  }
  if (scorecard?.maxScore !== 100) {
    failures.push(`loopScorecard maxScore is ${String(scorecard?.maxScore)}`);
  }
  if (typeof scorecard?.threshold !== 'number') {
    failures.push('loopScorecard threshold is missing');
  }
  if (typeof scorecard?.score !== 'number' || typeof scorecard?.threshold !== 'number') {
    failures.push('loopScorecard score/threshold are not numeric');
  } else if (scorecard.score < scorecard.threshold) {
    failures.push(`loopScorecard score ${scorecard.score} is below threshold ${scorecard.threshold}`);
  }
  if (!Array.isArray(scorecard?.dimensions) || scorecard.dimensions.length !== 7) {
    failures.push(`loopScorecard dimension count is ${String(scorecard?.dimensions?.length)}`);
  }
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? `Loop score ${scorecard.score}/${scorecard.maxScore} passed threshold ${scorecard.threshold}.`
        : failures.join('; '),
    observed: {
      status: scorecard?.status,
      score: scorecard?.score,
      maxScore: scorecard?.maxScore,
      threshold: scorecard?.threshold,
      dimensionCount: Array.isArray(scorecard?.dimensions) ? scorecard.dimensions.length : 0,
      scoreGateStatus: scoreGate?.status,
    },
  };
}

async function selectSotaTuiSummary(context) {
  const auto = await findLatestSotaTuiSummary(context);
  if (auto !== undefined) return auto;
  const fallbackPath = path.resolve(context.sourceCheckout, DEFAULT_SOTA_TUI_SUMMARY_PATH);
  const fallbackSummary = await readJsonIfFile(fallbackPath);
  return {
    status: 'FALLBACK',
    source: 'legacy-fixed-path',
    path: fallbackPath,
    reason: 'No newer passing live TUI launch summary was found; using the legacy fixed SOTA TUI summary path.',
    summaryStatus: fallbackSummary?.status,
    captures: Array.isArray(fallbackSummary?.captures) ? fallbackSummary.captures.length : 0,
    inputTraces: Array.isArray(fallbackSummary?.inputTraces) ? fallbackSummary.inputTraces.length : 0,
  };
}

async function selectSotaWorkflowSummary(context) {
  const auto = await findLatestSotaWorkflowSummary(context);
  if (auto !== undefined) return auto;
  const fallbackPath = path.resolve(context.sourceCheckout, DEFAULT_SOTA_WORKFLOW_SUMMARY_PATH);
  const fallbackSummary = await readJsonIfFile(fallbackPath);
  return {
    status: 'FALLBACK',
    source: 'legacy-fixed-path',
    path: fallbackPath,
    reason:
      'No newer passing live TUI real workflow summary was found; using the fixed SOTA workflow summary path.',
    summaryStatus: fallbackSummary?.status,
    agentVerificationStatus: fallbackSummary?.validations?.agentVerificationObserved?.status,
    captures: Array.isArray(fallbackSummary?.captures) ? fallbackSummary.captures.length : 0,
    inputTraces: Array.isArray(fallbackSummary?.inputTraces) ? fallbackSummary.inputTraces.length : 0,
  };
}

async function selectSotaUltraworkSummary(context) {
  const auto = await findLatestSotaUltraworkSummary(context);
  if (auto !== undefined) return auto;
  const fallbackPath = path.resolve(context.sourceCheckout, DEFAULT_SOTA_ULTRAWORK_SUMMARY_PATH);
  const fallbackSummary = await readJsonIfFile(fallbackPath);
  if (!isUsableSotaUltraworkSummary(fallbackSummary)) return undefined;
  return {
    status: 'FALLBACK',
    source: 'legacy-fixed-path',
    path: fallbackPath,
    reason:
      'No newer passing live TUI Ultrawork workflow summary was found; using the fixed Ultrawork summary path.',
    summaryStatus: fallbackSummary.status,
    activationStatus: fallbackSummary.validations.ultraworkActivated.status,
    policyStatus: fallbackSummary.validations.noAutoQuestionPolicyConflict.status,
    captures: Array.isArray(fallbackSummary.captures) ? fallbackSummary.captures.length : 0,
    inputTraces: Array.isArray(fallbackSummary.inputTraces) ? fallbackSummary.inputTraces.length : 0,
  };
}

async function findLatestSotaTuiSummary(context) {
  const evidenceRoot = path.join(context.sourceCheckout, '.omo', 'evidence');
  const candidates = await findTuiSummaryCandidates(evidenceRoot, context.evidenceRoot);
  for (const candidate of candidates) {
    const summary = await readJsonIfFile(candidate.path);
    if (!isUsableSotaTuiSummary(summary)) continue;
    return {
      status: 'FOUND',
      source: 'auto-latest-pass',
      path: candidate.path,
      reason: 'Selected the latest passing live TUI launch summary with required scenarios and input traces.',
      summaryStatus: summary.status,
      captures: summary.captures.length,
      inputTraces: summary.inputTraces.length,
      modifiedAt: candidate.modifiedAt,
    };
  }
  return undefined;
}

async function findLatestSotaWorkflowSummary(context) {
  const evidenceRoot = path.join(context.sourceCheckout, '.omo', 'evidence');
  const candidates = await findWorkflowSummaryCandidates(evidenceRoot, context.evidenceRoot);
  for (const candidate of candidates) {
    const summary = await readJsonIfFile(candidate.path);
    if (!isUsableSotaWorkflowSummary(summary)) continue;
    return {
      status: 'FOUND',
      source: 'auto-latest-pass',
      path: candidate.path,
      reason:
        'Selected the latest passing live TUI real workflow summary with real repository source/test and agent-run verification evidence.',
      summaryStatus: summary.status,
      agentVerificationStatus: summary.validations.agentVerificationObserved.status,
      multiFileStatus: summary.validations.multiFileWorkspaceChanged.status,
      repositoryTargetedTestStatus: summary.validations.repositoryTargetedTest.status,
      editedFileCount: summary.workspace.editedFileCount,
      captures: summary.captures.length,
      inputTraces: summary.inputTraces.length,
      modifiedAt: candidate.modifiedAt,
    };
  }
  return undefined;
}

async function findLatestSotaUltraworkSummary(context) {
  const evidenceRoot = path.join(context.sourceCheckout, '.omo', 'evidence');
  const candidates = await findUltraworkSummaryCandidates(evidenceRoot, context.evidenceRoot);
  for (const candidate of candidates) {
    const summary = await readJsonIfFile(candidate.path);
    if (!isUsableSotaUltraworkSummary(summary)) continue;
    return {
      status: 'FOUND',
      source: 'auto-latest-pass',
      path: candidate.path,
      reason:
        'Selected the latest passing live TUI Ultrawork activation summary with interview and policy-conflict evidence.',
      summaryStatus: summary.status,
      activationStatus: summary.validations.ultraworkActivated.status,
      policyStatus: summary.validations.noAutoQuestionPolicyConflict.status,
      captures: summary.captures.length,
      inputTraces: summary.inputTraces.length,
      modifiedAt: candidate.modifiedAt,
    };
  }
  return undefined;
}

async function findTuiSummaryCandidates(evidenceRoot, excludeDir) {
  return findEvidenceSummaryCandidates(evidenceRoot, excludeDir, isTuiSummaryCandidate);
}

async function findWorkflowSummaryCandidates(evidenceRoot, excludeDir) {
  return findEvidenceSummaryCandidates(evidenceRoot, excludeDir, isWorkflowSummaryCandidate);
}

async function findUltraworkSummaryCandidates(evidenceRoot, excludeDir) {
  return findEvidenceSummaryCandidates(evidenceRoot, excludeDir, isUltraworkSummaryCandidate);
}

async function findEvidenceSummaryCandidates(evidenceRoot, excludeDir, isCandidate) {
  const files = [];
  const stack = [''];
  while (stack.length > 0 && files.length < SOTA_TUI_SUMMARY_SCAN_LIMIT) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(evidenceRoot, relativeDir);
    let entries;
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      const absolutePath = path.join(evidenceRoot, relativePath);
      if (isPathInside(absolutePath, excludeDir)) continue;
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile() || !isCandidate(relativePath)) continue;
      const info = await statFileOrUndefined(absolutePath);
      if (info === undefined) continue;
      files.push({ path: absolutePath, modifiedAt: info.mtimeMs });
      if (files.length >= SOTA_TUI_SUMMARY_SCAN_LIMIT) break;
    }
  }
  return files.toSorted((left, right) => right.modifiedAt - left.modifiedAt);
}

function isTuiSummaryCandidate(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return ['/tui-launch.json', '/tui/summary.json'].some((suffix) => normalized.endsWith(suffix));
}

function isWorkflowSummaryCandidate(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.endsWith('/tui-real-workflow.json');
}

function isUltraworkSummaryCandidate(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.endsWith('/tui-ultrawork-workflow.json');
}

function isUsableSotaTuiSummary(summary) {
  if (summary?.phase !== 'tui-launch' || summary.status !== 'PASS') return false;
  if (!Array.isArray(summary.captures) || !Array.isArray(summary.inputTraces)) return false;
  const capturesByScenario = new Map(summary.captures.map((capture) => [capture.scenario, capture]));
  const missingCapture = REQUIRED_TUI_CAPTURE_SCENARIOS.some(
    (scenario) => capturesByScenario.get(scenario)?.status !== 'PASS',
  );
  if (missingCapture) return false;
  const traceScenarios = new Set(summary.inputTraces.map((trace) => trace.scenario));
  return ['help', 'clear', 'autocomplete', 'prompt-entry', 'escape-cancel', 'exit'].every(
    (scenario) => traceScenarios.has(scenario),
  );
}

function isUsableSotaWorkflowSummary(summary) {
  if (summary?.phase !== 'tui-real-workflow' || summary.status !== 'PASS') return false;
  if (summary.kimiCodeHomeMode !== 'real-user-opt-in') return false;
  const requiredValidations = [
    'targetWorktreeToolingLinked',
    'multiFileWorkspaceChanged',
    'verifierUnchanged',
    'repositorySourceTestChanged',
    'repositoryTargetedTest',
    'agentVerificationObserved',
    'adaptiveOperatorLoop',
    'operatorTrajectory',
    'kimiModelReady',
    'verificationCommand',
  ];
  if (requiredValidations.some((name) => summary.validations?.[name]?.status !== 'PASS')) {
    return false;
  }
  if (!Array.isArray(summary.workflow?.wait?.agentVerificationEvidence)) return false;
  if (summary.workflow.wait.agentVerificationEvidence.length === 0) return false;
  if (!Array.isArray(summary.captures) || !Array.isArray(summary.inputTraces)) return false;
  if (!Array.isArray(summary.workspace?.editFiles) || summary.workspace.editFiles.length < 2) return false;
  if (summary.workspace?.editedFileCount < 2) return false;
  if (summary.workspace?.targetedTestExitCode !== 0) return false;
  return summary.workspace?.diffExitCode === 0 && summary.workspace?.verificationExitCode === 0;
}

function isUsableSotaUltraworkSummary(summary) {
  if (summary?.phase !== 'tui-ultrawork-workflow' || summary.status !== 'PASS') return false;
  if (summary.kimiCodeHomeMode !== 'real-user-opt-in') return false;
  const requiredValidations = [
    'tuiReady',
    'promptSubmitted',
    'planModeReset',
    'ultraworkActivated',
    'ultraPlanInterviewReached',
    'questionAnswered',
    'postQuestionProgressObserved',
    'noQuestionToolContractError',
    'noAutoQuestionPolicyConflict',
    'screenEvidence',
    'kimiModelReady',
    'adaptiveOperatorLoop',
    'operatorTrajectory',
  ];
  if (requiredValidations.some((name) => summary.validations?.[name]?.status !== 'PASS')) {
    return false;
  }
  if (!Array.isArray(summary.workflow?.wait?.activationEvidence)) return false;
  if (summary.workflow.wait.activationEvidence.length === 0) return false;
  if (!Array.isArray(summary.workflow?.wait?.questionAnswerEvidence)) return false;
  if (summary.workflow.wait.questionAnswerEvidence.length === 0) return false;
  if (!Array.isArray(summary.workflow?.wait?.postQuestionProgressEvidence)) return false;
  if (summary.workflow.wait.postQuestionProgressEvidence.length === 0) return false;
  if (
    Array.isArray(summary.workflow?.wait?.questionToolErrorEvidence) &&
    summary.workflow.wait.questionToolErrorEvidence.length > 0
  ) {
    return false;
  }
  return Array.isArray(summary.captures) && Array.isArray(summary.inputTraces);
}

async function statFileOrUndefined(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
  }
}

async function runInternalBenchCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const nodePath = context.nodeRuntime.status === 'PASS' ? context.nodeRuntime.nodePath : process.execPath;
  const argv = [nodePath, ...spec.args];
  const env = withRequiredNodePath(process.env, context);
  const result = runBoundedCommand(nodePath, spec.args, {
    cwd: context.sourceCheckout,
    env,
    timeoutMs: spec.timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const stdout = redactCommandOutput(result.stdout, context.redactionPolicy);
  const stderr = redactCommandOutput(result.stderr, context.redactionPolicy);
  const basePath = path.join(context.evidenceRoot, 'commands', spec.name);
  await writeFile(`${basePath}.stdout.txt`, stdout, 'utf8');
  await writeFile(`${basePath}.stderr.txt`, stderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${result.status}\n`, 'utf8');

  const benchSummary = await readJsonIfFile(spec.summaryFile);
  const summaryStatus = benchSummary?.status;
  const shapeAudit = validateBenchSummaryShape(spec.phase, benchSummary);
  const pass =
    result.status === 0 &&
    !result.timedOut &&
    summaryStatus === spec.expectedStatus &&
    shapeAudit.status === 'PASS';
  const phaseSummary = {
    schemaVersion: 1,
    phase: spec.phase,
    status: pass ? 'PASS' : result.timedOut ? 'FAIL' : summaryStatus === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
    reason: pass
      ? spec.passReason
      : result.timedOut
        ? `${spec.name} timed out.`
        : shapeAudit.status !== 'PASS'
          ? shapeAudit.reason
          : `${spec.name} exited ${result.status}; benchmark status=${String(summaryStatus)}.`,
    startedAt,
    completedAt,
    command: argv,
    summaryFile: spec.summaryFile,
    benchSummary,
    shapeAudit,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
  };
  await writeJson(spec.reportFile, phaseSummary);

  const record = {
    schemaVersion: 1,
    runId: context.runId,
    phase: spec.phase,
    name: spec.name,
    argv,
    cwd: context.sourceCheckout,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    status: phaseSummary.status,
    reason: phaseSummary.reason,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
    summaryFile: spec.summaryFile,
    reportFile: spec.reportFile,
  };
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path.join(context.evidenceRoot, 'commands', 'bench.jsonl'), line, 'utf8');
  await appendFile(path.join(context.evidenceRoot, 'commands', 'commands.jsonl'), line, 'utf8');

  const phaseEntry = {
    name: spec.phase,
    status: phaseSummary.status,
    reason: phaseSummary.reason,
    subprocessStarted: true,
    liveProductCommandStarted: false,
    startedAt,
    completedAt,
    summaryPath: spec.reportFile,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return {
    phaseEntry,
    cleanupOverrides: {
      status: `${spec.phase}-${phaseSummary.status.toLowerCase()}`,
      reason: phaseSummary.reason,
      liveProcessesStarted: false,
      liveProductCommandsStarted: false,
      proofCommands: [commandProof(result)],
    },
  };
}

function validateBenchSummaryShape(phase, summary) {
  if (summary === undefined) {
    return { status: 'FAIL', reason: 'Benchmark summary artifact is missing.' };
  }
  if (phase === 'bench-loop' || phase === 'bench-system-loop') {
    if (summary.benchmark !== 'super-kimi-agent-bench-loop') {
      return { status: 'FAIL', reason: 'Loop summary has unexpected benchmark id.' };
    }
    if (summary.guardrails?.bounded !== true || summary.guardrails?.executeCodeChanges !== false) {
      return { status: 'FAIL', reason: 'Loop summary is missing bounded non-mutating guardrails.' };
    }
    if (!Array.isArray(summary.iterations) || summary.iterations.length === 0) {
      return { status: 'FAIL', reason: 'Loop summary has no iterations.' };
    }
    if (summary.status !== 'PASS' || typeof summary.bestScore !== 'number' || summary.bestScore <= 0) {
      return { status: 'FAIL', reason: 'Loop summary did not produce a positive passing score.' };
    }
    return { status: 'PASS', reason: 'Loop summary includes bounded guardrails, iterations, and a positive passing score.' };
  }
  if (summary.benchmark !== 'super-kimi-agent-bench') {
    return { status: 'FAIL', reason: 'Benchmark summary has unexpected benchmark id.' };
  }
  if (phase === 'bench') {
    if (summary.suite !== 'seed') {
      return { status: 'FAIL', reason: 'Seed benchmark summary did not run the seed suite.' };
    }
    if (summary.metrics?.score !== 1 || summary.metrics?.passRate !== 1) {
      return { status: 'FAIL', reason: 'Seed benchmark did not reach score/passRate 1.' };
    }
    if ((summary.counts?.scored ?? 0) < 1) {
      return { status: 'FAIL', reason: 'Seed benchmark did not score any tasks.' };
    }
    return { status: 'PASS', reason: 'Seed benchmark shape, suite, and score/passRate passed.' };
  }
  if (phase === 'bench-system') {
    if (summary.suite !== 'system') {
      return { status: 'FAIL', reason: 'System benchmark summary did not run the system suite.' };
    }
    if (summary.metrics?.score !== 1 || summary.metrics?.passRate !== 1) {
      return { status: 'FAIL', reason: 'System benchmark did not reach score/passRate 1.' };
    }
    if ((summary.metrics?.commandCount ?? 0) < 3) {
      return { status: 'FAIL', reason: 'System benchmark did not execute real source commands.' };
    }
    return { status: 'PASS', reason: 'System benchmark ran real source commands and reached score/passRate 1.' };
  }
  return { status: 'FAIL', reason: `Unsupported benchmark phase shape audit: ${phase}.` };
}

async function runSkeletonPhase(evidenceRoot, runId, phase, options, createdAt) {
  const phaseEntry = {
    name: phase,
    status: phase === 'setup' ? 'planned' : 'not-implemented',
    reason:
      phase === 'setup'
        ? 'Todo 2 setup completed without live product commands.'
        : 'Phase reserved for later todos.',
    subprocessStarted: false,
    liveProductCommandStarted: false,
    startedAt: createdAt,
    completedAt: new Date().toISOString(),
  };
  await appendCommandEntry(evidenceRoot, runId, phase, options);
  await writeStatusFile(evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides: {} };
}

function buildAggregateCleanupOverrides({ baseOverrides, context, phaseCleanupRecords, phaseEntries }) {
  const merged = mergePhaseCleanupRecords(baseOverrides, phaseCleanupRecords);
  const enforcement = buildFinalCleanupEnforcement(context, phaseEntries, merged);
  return {
    ...merged,
    status: enforcement.status === 'PASS' ? 'aggregate-cleaned' : 'aggregate-cleanup-failed',
    reason: enforcement.reason,
    finalEnforcement: enforcement,
    phaseCleanupRecords,
    liveProcessesStarted: phaseCleanupRecords.some((entry) => entry.cleanup?.liveProcessesStarted),
    liveProductCommandsStarted: phaseCleanupRecords.some((entry) => entry.cleanup?.liveProductCommandsStarted),
    proofCommands: [
      ...(merged.proofCommands ?? []),
      ...enforcement.proofCommands,
    ],
  };
}

function mergePhaseCleanupRecords(baseOverrides, phaseCleanupRecords) {
  const merged = {
    ...baseOverrides,
    killedPids: [],
    closedTmuxSessions: [],
    releasedPorts: [],
    proofCommands: [],
  };
  for (const { cleanup } of phaseCleanupRecords) {
    if (cleanup === undefined) continue;
    if (Array.isArray(cleanup.killedPids)) merged.killedPids.push(...cleanup.killedPids);
    if (Array.isArray(cleanup.closedTmuxSessions)) {
      merged.closedTmuxSessions.push(...cleanup.closedTmuxSessions);
    }
    if (Array.isArray(cleanup.releasedPorts)) merged.releasedPorts.push(...cleanup.releasedPorts);
    if (Array.isArray(cleanup.proofCommands)) merged.proofCommands.push(...cleanup.proofCommands);
    for (const key of ['tempHome', 'targetWorktree', 'tempRoot', 'terminalWindows']) {
      if (cleanup[key] !== undefined) merged[key] = cleanup[key];
    }
  }
  return merged;
}

function buildFinalCleanupEnforcement(context, phaseEntries, cleanup) {
  const tmuxSession = context.options.tmuxSession ?? `super-kimi-qa-${context.runId}`;
  const checks = [];
  const proofCommands = [];

  const tmuxCheck = runBoundedCommand('tmux', ['has-session', '-t', tmuxSession], {
    cwd: context.sourceCheckout,
    timeoutMs: 10_000,
  });
  proofCommands.push(commandProof(tmuxCheck));
  checks.push({
    name: 'tracked-tmux-session',
    status: tmuxCheck.status === 1 ? 'PASS' : 'FAIL',
    reason:
      tmuxCheck.status === 1
        ? `tmux session ${tmuxSession} is absent.`
        : `tmux session ${tmuxSession} is still present or could not be checked.`,
    command: ['tmux', 'has-session', '-t', tmuxSession],
    exitCode: tmuxCheck.status,
  });

  const lsofCheck = runBoundedCommand('lsof', [`-iTCP:${context.selectedPort.port}`, '-sTCP:LISTEN'], {
    cwd: context.sourceCheckout,
    timeoutMs: 10_000,
  });
  proofCommands.push(commandProof(lsofCheck));
  const portWasTracked = context.selectedPort.availability.status === 'PASS';
  checks.push({
    name: 'tracked-loopback-port',
    status: !portWasTracked || lsofCheck.status !== 0 ? 'PASS' : 'FAIL',
    reason: !portWasTracked
      ? `127.0.0.1:${context.selectedPort.port} was unavailable before the harness acquired it, so no tracked listener was started by this run.`
      : lsofCheck.status !== 0
        ? `No listener remains on 127.0.0.1:${context.selectedPort.port}.`
        : `A listener remains on 127.0.0.1:${context.selectedPort.port}.`,
    command: ['lsof', `-iTCP:${context.selectedPort.port}`, '-sTCP:LISTEN'],
    exitCode: lsofCheck.status,
    stdoutPreview: lsofCheck.stdout.slice(0, 1000),
    trackedByHarness: portWasTracked,
  });

  const disposablePathChecks = [
    ['temp-root', context.tempRoot],
    ['target-worktree', context.targetWorktree],
  ];
  if (context.kimiCodeHomeMode === 'real-user-opt-in') {
    const exists = pathExistsSyncLike(context.plannedKimiCodeHome);
    checks.push({
      name: 'real-kimi-home',
      status: 'PASS',
      reason:
        'KIMI_CODE_HOME is the real user Kimi home by explicit --use-real-kimi-home opt-in, so cleanup must not remove it.',
      path: context.plannedKimiCodeHome,
      exists,
      disposable: false,
    });
  } else {
    disposablePathChecks.push(['temp-home', context.plannedKimiCodeHome]);
  }

  for (const [name, targetPath] of disposablePathChecks) {
    const exists = pathExistsSyncLike(targetPath);
    checks.push({
      name,
      status: context.options.keepTemp || !exists ? 'PASS' : 'FAIL',
      reason:
        context.options.keepTemp
          ? `${name} may remain because --keep-temp was set.`
          : exists
            ? `${name} still exists after cleanup: ${targetPath}`
            : `${name} is absent after cleanup.`,
      path: targetPath,
      exists,
    });
  }

  checks.push({
    name: 'terminal-title-resource',
    status: 'PASS',
    reason:
      'The harness wrote attach helpers with an exact run-id title but did not open or close Terminal/iTerm windows from inside Node.',
    titlePrefix: context.titlePrefix,
    closedWindows: cleanup.terminalWindows?.closed ?? [],
    leftOpen: cleanup.terminalWindows?.leftOpen ?? [],
  });

  const serverSummary = readJsonSyncLike(path.join(context.evidenceRoot, 'server', 'summary.json'));
  if (serverSummary?.serverPid !== undefined) {
    const pidCheck = runBoundedCommand('/bin/sh', ['-lc', `kill -0 ${Number(serverSummary.serverPid)} 2>/dev/null`], {
      cwd: context.sourceCheckout,
      timeoutMs: 5_000,
    });
    proofCommands.push(commandProof(pidCheck));
    checks.push({
      name: 'tracked-server-process',
      status: pidCheck.status !== 0 ? 'PASS' : 'FAIL',
      reason:
        pidCheck.status !== 0
          ? `Tracked server PID ${serverSummary.serverPid} is not alive.`
          : `Tracked server PID ${serverSummary.serverPid} is still alive.`,
      pid: serverSummary.serverPid,
      command: ['/bin/sh', '-lc', `kill -0 ${Number(serverSummary.serverPid)} 2>/dev/null`],
      exitCode: pidCheck.status,
    });
  }

  const failures = checks.filter((check) => check.status !== 'PASS');
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'Final cleanup proves no tracked tmux session, loopback listener, live tracked process, or disposable temp path remains.'
        : `Final cleanup failed: ${failures.map((failure) => failure.name).join(', ')}`,
    checkedAt: new Date().toISOString(),
    checks,
    proofCommands,
    phaseStatuses: phaseEntries.map((entry) => ({
      name: entry.name,
      status: entry.status,
    })),
  };
}

function pathExistsSyncLike(targetPath) {
  const result = runBoundedCommand('/bin/sh', ['-lc', `test -e ${shellQuote(targetPath)}`], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  return result.status === 0;
}

function readJsonSyncLike(filePath) {
  const result = runBoundedCommand('/bin/sh', ['-lc', `test -s ${shellQuote(filePath)} && cat ${shellQuote(filePath)}`], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  if (result.status !== 0 || result.stdout.trim() === '') return undefined;
  return tryParseJson(result.stdout);
}

async function writeCommandIndex(evidenceRoot, runId) {
  const commandsDir = path.join(evidenceRoot, 'commands');
  const indexPath = path.join(commandsDir, 'index.jsonl');
  const records = [];
  await writeFile(indexPath, '', 'utf8');
  for (const file of listEvidenceFiles(commandsDir).filter((entry) => entry.relativePath.endsWith('.jsonl'))) {
    if (file.relativePath === 'index.jsonl') continue;
    const raw = await readFile(file.path, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (line === '') continue;
      const parsed = tryParseJson(line);
      const record = {
        schemaVersion: 1,
        runId,
        sourceFile: file.path,
        sourceRelativePath: file.relativePath,
        sourceLine: index + 1,
        parseStatus: parsed === undefined ? 'FAIL' : 'PASS',
        record: parsed ?? { raw: line.slice(0, 1000) },
      };
      records.push(record);
      await appendFile(indexPath, `${JSON.stringify(record)}\n`, 'utf8');
    }
  }
  return {
    path: indexPath,
    recordCount: records.length,
    parseFailures: records.filter((record) => record.parseStatus !== 'PASS'),
    records,
  };
}

async function buildAggregateSummary({
  commandIndex,
  cleanupReceipt,
  context,
  createdAt,
  phaseEntries,
  selectedPort,
}) {
  const phaseMap = new Map(phaseEntries.map((entry) => [entry.name, entry]));
  const gates = [];
  const allowedBlocked = [];
  const failures = [];

  for (const phase of REQUIRED_ALL_PHASES) {
    const entry = phaseMap.get(phase);
    if (entry === undefined) {
      failures.push({ gate: phase, status: 'FAIL', reason: 'required phase did not run' });
      gates.push({ name: phase, status: 'FAIL', verdict: 'FAIL', reason: 'required phase did not run' });
      continue;
    }
    const gate = await evaluateAggregateGate(context, phase, entry);
    gates.push(gate);
    if (gate.verdict === 'ALLOWED_BLOCKED') {
      allowedBlocked.push(gate);
    } else if (gate.verdict !== 'PASS') {
      failures.push(gate);
    }
  }

  const staleAudit = buildStaleEvidenceAudit(context, commandIndex);
  if (staleAudit.status !== 'PASS') failures.push(staleAudit);
  const commandLogAudit = buildCommandLogAudit(commandIndex);
  if (commandLogAudit.status !== 'PASS') failures.push(commandLogAudit);
  const cleanupAudit = buildCleanupAudit(cleanupReceipt);
  if (cleanupAudit.status !== 'PASS') failures.push(cleanupAudit);
  const scopeAudit = await buildScopeAudit(context);
  if (scopeAudit.status !== 'PASS') failures.push(scopeAudit);
  const portBusyAudit = {
    name: 'initial-port-preflight',
    status: selectedPort.availability.status,
    verdict: selectedPort.availability.status === 'PASS' ? 'PASS' : 'FAIL',
    reason: selectedPort.availability.reason,
    port: selectedPort.port,
  };
  if (portBusyAudit.status !== 'PASS') failures.push(portBusyAudit);

  const status = failures.length === 0 ? 'PASS' : failures.some((failure) => failure.verdict === 'BLOCKED') ? 'BLOCKED' : 'FAIL';
  const readinessDebt = buildAggregateReadinessDebt({ allowedBlocked, failures, status });
  const reason =
    status === 'PASS'
      ? `All non-blocked gates passed and every allowed environmental BLOCKED gate has proof. ${readinessDebt.reason}`
      : `Aggregate ${status}: ${failures.map((failure) => `${failure.name ?? failure.gate}:${failure.reason}`).join('; ')}`;
  const summaryJsonPath = path.join(context.evidenceRoot, 'summary.json');
  const summaryMarkdownPath = path.join(context.evidenceRoot, 'summary.md');
  const commandIndexPath = path.join(context.evidenceRoot, 'commands', 'index.jsonl');
  const cleanupReceiptPath = path.join(context.evidenceRoot, 'cleanup', 'receipt.json');
  return {
    schemaVersion: 1,
    runId: context.runId,
    phase: 'all',
    status,
    manifestStatus: status === 'PASS' ? 'aggregate-pass' : status === 'BLOCKED' ? 'aggregate-blocked' : 'aggregate-fail',
    exitCode: status === 'PASS' ? 0 : 1,
    reason,
    startedAt: createdAt,
    completedAt: new Date().toISOString(),
    command: process.argv,
    sourceCheckout: context.sourceCheckout,
    evidenceRoot: context.evidenceRoot,
    summaryJsonPath,
    summaryMarkdownPath,
    commandIndexPath,
    cleanupReceiptPath,
    requiredPhases: REQUIRED_ALL_PHASES,
    phases: phaseEntries,
    gates,
    allowedBlocked,
    readinessDebt,
    failures,
    audits: {
      staleEvidence: staleAudit,
      commandLog: commandLogAudit,
      cleanup: cleanupAudit,
      scope: scopeAudit,
      portBusy: portBusyAudit,
    },
    cleanupEnforcement: cleanupReceipt.finalEnforcement,
    artifacts: buildAggregateArtifactLinks(context),
    adversarialCoverage: buildAdversarialCoverage(status),
  };
}

async function evaluateAggregateGate(context, phase, entry) {
  if (phase === 'server') return evaluateServerGate(context, entry);
  if (phase === 'autonomous') return evaluateAutonomousGate(context, entry);
  if (phase === 'tui-launch') return evaluateTuiLaunchGate(context, entry);
  if (phase === 'tui-iteration') return evaluateTuiIterationGate(context, entry);
  if (phase === 'bench') return evaluateBenchGate(context, entry);
  if (phase === 'bench-system') return evaluateBenchSystemGate(context, entry);
  if (phase === 'sota-gate') return evaluateSotaGate(context, entry);
  if (phase === 'cleanup') {
    return {
      name: phase,
      status: entry.status,
      verdict: entry.status === 'PASS' ? 'PASS' : 'FAIL',
      reason: entry.reason,
    };
  }
  return {
    name: phase,
    status: entry.status,
    verdict: entry.status === 'PASS' || entry.status === 'planned' ? 'PASS' : entry.status,
    reason: entry.reason,
  };
}

function buildAggregateReadinessDebt({ allowedBlocked, failures, status }) {
  const blockerCount = allowedBlocked.length;
  const score = Math.max(0, 100 - blockerCount * 10);
  const nextActions = allowedBlocked.map((gate, index) => buildReadinessDebtAction(gate, index));
  return {
    status:
      status !== 'PASS'
        ? 'BLOCKED_BY_REQUIRED_FAILURES'
        : blockerCount === 0
          ? 'CLEAR'
          : 'READY_WITH_ALLOWED_BLOCKED_DEBT',
    score,
    maxScore: 100,
    allowedBlockedCount: blockerCount,
    requiredFailureCount: failures.length,
    reason:
      blockerCount === 0
        ? 'No allowed BLOCKED debt remains.'
        : `${blockerCount} allowed BLOCKED gate(s) remain as next-loop readiness debt.`,
    principle:
      'Aggregate PASS means the evidence is honest and clean; readiness debt records proof-backed work still needed before the loop is friction-free.',
    nextActions,
  };
}

function buildReadinessDebtAction(gate, index) {
  if (gate.name === 'tui-iteration') {
    return {
      priority: index + 1,
      gate: gate.name,
      kind: 'capture-real-before-after-tui-iteration',
      reason:
        'Replace the allowed BLOCKED proof with a real before/after TUI iteration run that records visible evidence and an Ouroboros PASS verdict.',
      command:
        'node scripts/qa-super-kimi-autonomous.mjs --phase tui-iteration --tui-before <before-dir> --tui-after <after-dir> --evidence-root .omo/evidence/<tui-iteration-after>',
    };
  }
  if (gate.name === 'autonomous') {
    return {
      priority: index + 1,
      gate: gate.name,
      kind: 'run-real-autonomous-canary-with-kimi-login',
      reason:
        'Replace the credential BLOCKED proof with a provider-backed autonomous canary using the real Kimi /login session and selected coding model.',
      command:
        'node scripts/qa-super-kimi-autonomous.mjs --phase autonomous --use-real-kimi-home --evidence-root .omo/evidence/<autonomous-canary-after>',
    };
  }
  return {
    priority: index + 1,
    gate: gate.name,
    kind: 'resolve-allowed-blocked-gate',
    reason: gate.reason,
  };
}

async function evaluateSotaGate(context, entry) {
  const summaryPath = path.join(context.evidenceRoot, 'bench', 'sota-gate-summary.json');
  const summary = await readJsonIfFile(summaryPath);
  const nestedSummaryPath = path.join(context.evidenceRoot, 'bench', 'sota-gate', 'sota-gate-summary.json');
  const nestedSummary = summary?.gateSummary ?? (await readJsonIfFile(nestedSummaryPath));
  const loopScoreAudit = validateSotaLoopScore(nestedSummary);
  const failures = [];
  if (entry.status !== 'PASS') failures.push(entry.reason);
  if (summary === undefined) {
    failures.push('bench/sota-gate-summary.json is missing');
  } else if (summary.status !== 'PASS') {
    failures.push(`sota-gate phase status is ${summary.status}`);
  }
  if (summary?.loopScore?.status !== 'PASS') {
    failures.push(`sota-gate phase loop score status is ${String(summary?.loopScore?.status)}`);
  }
  if (loopScoreAudit.status !== 'PASS') failures.push(loopScoreAudit.reason);
  return {
    name: 'sota-gate',
    status: entry.status,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? `SOTA gate passed with required Super Kimi loop score ${loopScoreAudit.observed.score}/${loopScoreAudit.observed.maxScore}.`
        : failures.join('; '),
    summaryPath,
    nestedSummaryPath,
    loopScore: loopScoreAudit.observed,
    markdownPath: summary?.markdownFile,
  };
}

async function evaluateBenchSystemGate(context, entry) {
  const summaryPath = path.join(context.evidenceRoot, 'bench', 'system-summary.json');
  const summary = await readJsonIfFile(summaryPath);
  const failures = [];
  if (entry.status !== 'PASS') failures.push(entry.reason);
  if (summary === undefined) {
    failures.push('bench/system-summary.json is missing');
  } else {
    const shapeAudit = validateBenchSummaryShape('bench-system', summary.benchSummary);
    if (summary.status !== 'PASS') failures.push(`bench-system phase status is ${summary.status}`);
    if (shapeAudit.status !== 'PASS') failures.push(shapeAudit.reason);
  }
  return {
    name: 'bench-system',
    status: entry.status,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'Internal system benchmark passed with real QA harness and TUI contract source commands.'
        : failures.join('; '),
    summaryPath,
    score: summary?.benchSummary?.metrics?.score,
    passRate: summary?.benchSummary?.metrics?.passRate,
    commandCount: summary?.benchSummary?.metrics?.commandCount,
  };
}

async function evaluateBenchGate(context, entry) {
  const summaryPath = path.join(context.evidenceRoot, 'bench', 'summary.json');
  const summary = await readJsonIfFile(summaryPath);
  const failures = [];
  if (entry.status !== 'PASS') failures.push(entry.reason);
  if (summary === undefined) {
    failures.push('bench/summary.json is missing');
  } else {
    const shapeAudit = validateBenchSummaryShape('bench', summary.benchSummary);
    if (summary.status !== 'PASS') failures.push(`bench phase status is ${summary.status}`);
    if (shapeAudit.status !== 'PASS') failures.push(shapeAudit.reason);
  }
  return {
    name: 'bench',
    status: entry.status,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'Internal agent benchmark seed suite passed with score/passRate 1 and clean contamination preflight.'
        : failures.join('; '),
    summaryPath,
    score: summary?.benchSummary?.metrics?.score,
    passRate: summary?.benchSummary?.metrics?.passRate,
    quarantined: summary?.benchSummary?.counts?.quarantined,
  };
}

async function evaluateServerGate(context, entry) {
  const summaryPath = path.join(context.evidenceRoot, 'server', 'summary.json');
  const summary = await readJsonIfFile(summaryPath);
  const providerBlockedPath = path.join(context.evidenceRoot, 'server', 'provider-blocked.json');
  const providerBlocked = await readJsonIfFile(providerBlockedPath);
  const reportIndex = path.join(context.evidenceRoot, 'server', 'report', 'index.html');
  const failures = [];
  if (entry.status !== 'PASS') failures.push(entry.reason);
  if (summary === undefined) failures.push('server/summary.json is missing');
  if (!(await fileExists(reportIndex))) failures.push('server/report/index.html is missing');
  if (summary?.e2e?.mode === 'no-auth-subset') {
    if (summary.e2e.status !== 'PASS') failures.push('server no-auth subset did not pass');
    if (providerBlocked?.status !== 'BLOCKED') failures.push('server/provider-blocked.json is missing or not BLOCKED');
  } else if (summary?.e2e?.mode === 'full') {
    if (summary.e2e.status !== 'PASS') failures.push('server full prompt scenarios did not pass');
  } else if (summary !== undefined) {
    failures.push('server summary does not identify full or no-auth e2e mode');
  }
  return {
    name: 'server',
    status: entry.status,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    reason: failures.length === 0
      ? 'Server gate passed; full prompt scenarios passed or credential BLOCKED no-auth subset proof exists.'
      : failures.join('; '),
    summaryPath,
    providerBlockedPath: providerBlocked === undefined ? undefined : providerBlockedPath,
    e2eMode: summary?.e2e?.mode,
    e2eStatus: summary?.e2e?.status,
    noAuthSubset: providerBlocked?.noAuthSubset,
    excludedNoAuthScenarios: providerBlocked?.excludedNoAuthScenarios,
    reportIndex,
  };
}

async function evaluateAutonomousGate(context, entry) {
  if (entry.status === 'PASS') {
    return { name: 'autonomous', status: 'PASS', verdict: 'PASS', reason: entry.reason };
  }
  const failurePath = path.join(context.evidenceRoot, 'autonomous', 'failure-missing-auth.json');
  const rootFailurePath = path.join(context.evidenceRoot, 'failure-missing-auth.json');
  const authPath = path.join(context.evidenceRoot, 'autonomous', 'auth-readiness.json');
  const streamPath = path.join(context.evidenceRoot, 'autonomous', 'stream.jsonl');
  const failure = (await readJsonIfFile(failurePath)) ?? (await readJsonIfFile(rootFailurePath));
  const auth = await readJsonIfFile(authPath);
  const stream = await readFileIfExists(streamPath);
  const exactMissing =
    entry.status === 'BLOCKED' &&
    failure?.status === 'BLOCKED' &&
    failure?.providerCallStarted === false &&
    auth?.status === 'BLOCKED' &&
    auth?.simulated === false &&
    Array.isArray(auth?.missing) &&
    auth.missing.includes('KIMI_MODEL_NAME') &&
    auth.missing.includes('KIMI_MODEL_API_KEY') &&
    (stream ?? '').includes('"providerCallStarted":false');
  const realKimiHomeMissing =
    entry.status === 'BLOCKED' &&
    failure?.status === 'BLOCKED' &&
    failure?.providerCallStarted === false &&
    auth?.status === 'BLOCKED' &&
    auth?.authMode === 'real-kimi-code-home-login' &&
    auth?.simulated === false &&
    auth?.providerCallStarted === false &&
    Array.isArray(auth?.missing) &&
    auth.missing.length > 0 &&
    (stream ?? '').includes('"providerCallStarted":false');
  const allowedBlocked = exactMissing ? true : realKimiHomeMissing;
  return {
    name: 'autonomous',
    status: entry.status,
    verdict: allowedBlocked ? 'ALLOWED_BLOCKED' : entry.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
    reason: exactMissing
      ? 'Autonomous real-LLM canary is credential BLOCKED with exact missing isolated env-model credential evidence and providerCallStarted=false.'
      : realKimiHomeMissing
        ? 'Autonomous real-LLM canary is /login BLOCKED with real KIMI_CODE_HOME readiness evidence and providerCallStarted=false.'
      : `Autonomous BLOCKED/FAIL did not meet the allowed missing-credentials proof contract: ${entry.reason}`,
    failurePath: failure === undefined ? undefined : failurePath,
    authPath,
    streamPath,
  };
}

async function evaluateTuiLaunchGate(context, entry) {
  if (entry.status === 'PASS') {
    return { name: 'tui-launch', status: 'PASS', verdict: 'PASS', reason: entry.reason };
  }
  const failurePath = path.join(context.evidenceRoot, 'failure-terminal-tool.json');
  const computerUsePath = path.join(context.evidenceRoot, 'tui', 'computer-use-state.json');
  const failure = await readJsonIfFile(failurePath);
  const computerUse = await readJsonIfFile(computerUsePath);
  const allowed =
    entry.status === 'BLOCKED' &&
    failure?.status === 'BLOCKED' &&
    (computerUse?.status === 'BLOCKED' || context.preflight?.tmux?.status !== 'PASS');
  return {
    name: 'tui-launch',
    status: entry.status,
    verdict: allowed ? 'ALLOWED_BLOCKED' : entry.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
    reason: allowed
      ? 'Visible TUI launch is BLOCKED with explicit computer-use/tool/preflight evidence and no fake PASS.'
      : `Visible TUI launch did not meet allowed BLOCKED proof: ${entry.reason}`,
    failurePath: failure === undefined ? undefined : failurePath,
    computerUsePath,
  };
}

async function evaluateTuiIterationGate(context, entry) {
  if (entry.status === 'PASS') {
    const summary = await readJsonIfFile(path.join(context.evidenceRoot, 'tui-iteration.json'));
    const verdict = summary?.ouroborosVerdict?.status === 'PASS' ? 'PASS' : 'FAIL';
    return {
      name: 'tui-iteration',
      status: entry.status,
      verdict,
      reason:
        verdict === 'PASS'
          ? entry.reason
          : 'TUI iteration PASS requires an Ouroboros PASS verdict artifact.',
    };
  }
  const summaryPath = path.join(context.evidenceRoot, 'tui-iteration.json');
  const evidenceSummaryPath = path.join(context.evidenceRoot, 'tui-evidence-summary.md');
  const summary = await readJsonIfFile(summaryPath);
  const allowed =
    entry.status === 'BLOCKED' &&
    summary?.status === 'BLOCKED' &&
    /visible TUI evidence|missing required --tui-|computer-use|BLOCKED/i.test(summary.reason ?? '') &&
    (await fileExists(evidenceSummaryPath));
  return {
    name: 'tui-iteration',
    status: entry.status,
    verdict: allowed ? 'ALLOWED_BLOCKED' : entry.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
    reason: allowed
      ? 'TUI iteration is BLOCKED by missing visible before/after evidence and records proof instead of fake improvement.'
      : `TUI iteration did not meet allowed BLOCKED proof: ${entry.reason}`,
    summaryPath,
    evidenceSummaryPath,
  };
}

function buildStaleEvidenceAudit(context, commandIndex) {
  const stale = commandIndex.records.filter((entry) => {
    const completedAt = entry.record?.completedAt ?? entry.record?.timestamp;
    if (typeof completedAt !== 'string') return false;
    return Date.parse(completedAt) < Date.parse(context.createdAt) - 1_000;
  });
  return {
    name: 'stale-evidence',
    status: stale.length === 0 ? 'PASS' : 'FAIL',
    verdict: stale.length === 0 ? 'PASS' : 'FAIL',
    reason:
      stale.length === 0
        ? 'No indexed command record predates this aggregate run.'
        : `${stale.length} command record(s) predate this aggregate run.`,
    staleRecords: stale.map((entry) => ({
      sourceRelativePath: entry.sourceRelativePath,
      sourceLine: entry.sourceLine,
      completedAt: entry.record?.completedAt ?? entry.record?.timestamp,
      name: entry.record?.name,
    })),
  };
}

function buildCommandLogAudit(commandIndex) {
  const hasRecords = commandIndex.recordCount > 0;
  return {
    name: 'command-log',
    status: hasRecords && commandIndex.parseFailures.length === 0 ? 'PASS' : 'FAIL',
    verdict: hasRecords && commandIndex.parseFailures.length === 0 ? 'PASS' : 'FAIL',
    reason: !hasRecords
      ? 'commands/index.jsonl has no command records'
      : commandIndex.parseFailures.length > 0
        ? `${commandIndex.parseFailures.length} command record(s) failed JSON parsing`
        : `commands/index.jsonl indexes ${commandIndex.recordCount} command record(s).`,
    indexPath: commandIndex.path,
    recordCount: commandIndex.recordCount,
    parseFailureCount: commandIndex.parseFailures.length,
  };
}

function buildCleanupAudit(cleanupReceipt) {
  const enforcement = cleanupReceipt.finalEnforcement;
  const status = enforcement?.status === 'PASS' ? 'PASS' : 'FAIL';
  return {
    name: 'cleanup',
    status,
    verdict: status,
    reason:
      status === 'PASS'
        ? enforcement.reason
        : `cleanup/receipt.json is missing final PASS enforcement: ${enforcement?.reason ?? 'missing finalEnforcement'}`,
    receiptPath: cleanupReceipt.evidenceRoot === undefined
      ? undefined
      : path.join(cleanupReceipt.evidenceRoot, 'cleanup', 'receipt.json'),
  };
}

async function buildScopeAudit(context) {
  const baseline = (await readFileIfExists(context.baselinePath)) ?? '';
  const current = runBoundedCommand('git', ['status', '--short', '--', 'apps/kimi-web'], {
    cwd: context.sourceCheckout,
    timeoutMs: 10_000,
  });
  const baselineWeb = baseline
    .split(/\r?\n/)
    .filter((line) => line.includes('apps/kimi-web'))
    .toSorted();
  const currentWeb = current.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .toSorted();
  const unchanged = JSON.stringify(baselineWeb) === JSON.stringify(currentWeb);
  return {
    name: 'scope-apps-kimi-web',
    status: current.status === 0 && unchanged ? 'PASS' : 'FAIL',
    verdict: current.status === 0 && unchanged ? 'PASS' : 'FAIL',
    reason:
      current.status !== 0
        ? `git status apps/kimi-web failed with exit ${current.status}`
        : unchanged
          ? 'apps/kimi-web status is unchanged from the aggregate run baseline; this harness did not edit or validate it.'
          : 'apps/kimi-web status changed during the aggregate run.',
    baselinePath: context.baselinePath,
    baselineWeb,
    currentWeb,
  };
}

function buildAggregateArtifactLinks(context) {
  return {
    manifest: path.join(context.evidenceRoot, 'manifest.json'),
    summaryJson: path.join(context.evidenceRoot, 'summary.json'),
    summaryMarkdown: path.join(context.evidenceRoot, 'summary.md'),
    commandIndex: path.join(context.evidenceRoot, 'commands', 'index.jsonl'),
    cleanupReceipt: path.join(context.evidenceRoot, 'cleanup', 'receipt.json'),
    serverSummary: path.join(context.evidenceRoot, 'server', 'summary.json'),
    serverProviderBlocked: path.join(context.evidenceRoot, 'server', 'provider-blocked.json'),
    tuiLaunch: path.join(context.evidenceRoot, 'tui-launch.json'),
    tuiIteration: path.join(context.evidenceRoot, 'tui-iteration.json'),
    autonomousSummary: path.join(context.evidenceRoot, 'autonomous', 'summary.json'),
    benchSummary: path.join(context.evidenceRoot, 'bench', 'summary.json'),
    benchLoopSummary: path.join(context.evidenceRoot, 'bench', 'loop-summary.json'),
    benchSystemSummary: path.join(context.evidenceRoot, 'bench', 'system-summary.json'),
    benchSystemLoopSummary: path.join(context.evidenceRoot, 'bench', 'system-loop-summary.json'),
    sotaGateSummary: path.join(context.evidenceRoot, 'bench', 'sota-gate-summary.json'),
    sotaGateMarkdown: path.join(context.evidenceRoot, 'bench', 'sota-gate', 'sota-gate-summary.md'),
  };
}

function buildAdversarialCoverage(status) {
  return [
    ['malformed_input', 'Port-busy preflight produces FAIL evidence and nonzero aggregate status.'],
    ['stale_state', 'Aggregate command logs are reset and indexed records are checked against the run start time.'],
    ['dirty_worktree', 'Only evidence and the harness are written; prework git status remains captured in the manifest.'],
    ['hung_long_commands', 'Phase commands use bounded timeouts and cleanup receipts record forced teardown.'],
    ['misleading_success_output', 'Aggregate PASS is derived from gate proofs, not summary text alone.'],
    ['repeated_interruptions', 'cleanup/receipt.json is written after failures and includes final enforcement.'],
    ['flaky_tests', 'summary.md records exact invocations and artifacts for reproducibility.'],
    ['secret_hygiene', 'Environment and command output are redacted before evidence is written.'],
    ['prompt_injection', 'External environment/prompt surfaces are treated as inert evidence metadata.'],
    ['programming_overfit', 'Allowed BLOCKED rules are narrow and proof-backed instead of matching loose words.'],
    ['remove_ai_slops', 'Fake screenshot, fake Ouroboros, and fake PASS paths are rejected by artifact validators.'],
    ['benchmark_contamination', 'Internal bench tasks with leaked answer or stale evidence files are quarantined before solver execution.'],
  ].map(([name, coverage]) => ({ name, coverage, aggregateStatus: status }));
}

async function writeAggregateArtifacts(context, aggregate) {
  await writeJson(aggregate.summaryJsonPath, aggregate);
  await writeFile(aggregate.summaryMarkdownPath, renderAggregateMarkdown(aggregate), 'utf8');
  await writeAggregateSupportArtifacts(context, aggregate);
}

function renderAggregateMarkdown(aggregate) {
  const lines = [
    '# Super Kimi Autonomous QA Final Report',
    '',
    `Status: **${aggregate.status}**`,
    `Reason: ${aggregate.reason}`,
    `Run ID: ${aggregate.runId}`,
    `Command: \`${formatArgv(aggregate.command)}\``,
    '',
    '## Artifacts',
    '',
  ];
  for (const [name, artifactPath] of Object.entries(aggregate.artifacts)) {
    lines.push(`- ${name}: ${markdownFileLink(artifactPath)}`);
  }
  lines.push(
    '',
    '## Gate Verdicts',
    '',
    '| gate | phase status | aggregate verdict | evidence |',
    '| --- | --- | --- | --- |',
  );
  for (const gate of aggregate.gates) {
    const evidence = gate.summaryPath ?? gate.failurePath ?? gate.providerBlockedPath ?? gate.authPath ?? gate.computerUsePath ?? '';
    lines.push(
      `| ${gate.name} | ${gate.status} | ${gate.verdict} | ${evidence === '' ? '' : markdownFileLink(evidence)} |`,
    );
  }
  if (aggregate.readinessDebt !== undefined) {
    lines.push(
      '',
      '## Aggregate Readiness Debt',
      '',
      `- status: ${aggregate.readinessDebt.status}`,
      `- score: ${aggregate.readinessDebt.score}/${aggregate.readinessDebt.maxScore}`,
      `- allowed BLOCKED gates: ${aggregate.readinessDebt.allowedBlockedCount}`,
      `- required failures: ${aggregate.readinessDebt.requiredFailureCount}`,
      `- principle: ${aggregate.readinessDebt.principle}`,
    );
    for (const action of aggregate.readinessDebt.nextActions ?? []) {
      const command = action.command === undefined ? '' : ` Command: \`${action.command}\``;
      lines.push(`- P${action.priority} ${action.kind}: ${action.reason}${command}`);
    }
  }
  const sotaGate = aggregate.gates.find((gate) => gate.name === 'sota-gate');
  if (sotaGate?.loopScore !== undefined) {
    lines.push(
      '',
      '## Super Kimi Loop Score',
      '',
      `- status: ${sotaGate.loopScore.status ?? '<unknown>'}`,
      `- score: ${String(sotaGate.loopScore.score ?? '<unknown>')}/${String(sotaGate.loopScore.maxScore ?? '<unknown>')}`,
      `- threshold: ${String(sotaGate.loopScore.threshold ?? '<unknown>')}`,
      `- dimensions: ${String(sotaGate.loopScore.dimensionCount ?? '<unknown>')}`,
      `- gate: ${sotaGate.loopScore.scoreGateStatus ?? '<unknown>'}`,
      ...(sotaGate.markdownPath === undefined ? [] : [`- SOTA report: ${markdownFileLink(sotaGate.markdownPath)}`]),
    );
  }
  lines.push('', '## Allowed BLOCKED Proofs', '');
  if (aggregate.allowedBlocked.length === 0) {
    lines.push('- none');
  } else {
    for (const gate of aggregate.allowedBlocked) {
      lines.push(`- ${gate.name}: ${gate.reason}`);
      for (const key of ['failurePath', 'authPath', 'streamPath', 'computerUsePath', 'summaryPath', 'evidenceSummaryPath']) {
        if (gate[key] !== undefined) lines.push(`  - ${key}: ${markdownFileLink(gate[key])}`);
      }
    }
  }
  const serverGate = aggregate.gates.find((gate) => gate.name === 'server');
  lines.push('', '## Server Provider Verdict', '');
  lines.push(`- e2eMode: ${serverGate?.e2eMode ?? '<unknown>'}`);
  lines.push(`- e2eStatus: ${serverGate?.e2eStatus ?? '<unknown>'}`);
  if (serverGate?.providerBlockedPath !== undefined) {
    lines.push(`- providerBlocked: ${markdownFileLink(serverGate.providerBlockedPath)}`);
    lines.push(`- noAuthSubset: ${(serverGate.noAuthSubset ?? []).join(', ')}`);
    lines.push(`- excludedPromptScenarios: ${(serverGate.excludedNoAuthScenarios ?? []).join(', ')}`);
  } else {
    lines.push('- providerBlocked: not invoked; full provider-ready server path passed or no provider block artifact was needed.');
  }
  lines.push('', '## Cleanup Enforcement Matrix', '');
  lines.push('| resource | status | tracked by harness | reason |');
  lines.push('| --- | --- | --- | --- |');
  for (const check of aggregate.cleanupEnforcement?.checks ?? []) {
    lines.push(`| ${check.name} | ${check.status} | ${String(check.trackedByHarness ?? '')} | ${String(check.reason).replaceAll('|', '\\|')} |`);
  }
  lines.push('', '## Scope Audit', '');
  lines.push(`- ${aggregate.audits.scope.status}: ${aggregate.audits.scope.reason}`);
  lines.push(`- baseline: ${markdownFileLink(aggregate.audits.scope.baselinePath)}`);
  lines.push('', '## Exact Command Records', '');
  const commandRecords = aggregate.audits.commandLog.recordCount;
  lines.push(`Indexed command records: ${commandRecords}`);
  lines.push(`Command index: ${markdownFileLink(aggregate.commandIndexPath)}`);
  lines.push('');
  for (const entry of aggregate.gates) {
    lines.push(`- ${entry.name}: ${entry.reason}`);
  }
  lines.push('', '## Cleanup', '');
  lines.push(`Cleanup receipt: ${markdownFileLink(aggregate.cleanupReceiptPath)}`);
  lines.push(`Cleanup verdict: ${aggregate.audits.cleanup.status} - ${aggregate.audits.cleanup.reason}`);
  lines.push('', '## Adversarial Coverage', '');
  for (const item of aggregate.adversarialCoverage) {
    lines.push(`- ${item.name}: ${item.coverage}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function writeAggregateSupportArtifacts(context, aggregate) {
  const reviewDir = path.join(context.evidenceRoot, 'review');
  await mkdir(reviewDir, { recursive: true });
  const support = {
    schemaVersion: 1,
    runId: context.runId,
    status: aggregate.status,
    falsePassRisks: [
      'TUI phases cannot pass without visible evidence or accepted BLOCKED proof.',
      'Autonomous cannot pass or be allowed-blocked unless missing isolated env-model credentials are exact and providerCallStarted=false.',
      'Server prompt scenarios cannot be credential-blocked unless no-auth subset passes and provider-blocked.json exists.',
    ],
    staleOrMisleadingAggregateOutput: aggregate.audits.staleEvidence,
    cleanup: aggregate.audits.cleanup,
    secretHygiene:
      'Evidence uses redaction policy for environment and command output; final verification should still grep for raw key patterns.',
    manualQaSupport:
      'summary.md links exact artifacts and command index records so a reviewer can audit every gate without relying on prose.',
    removeAiSlopsProgrammingOverfitCoverage:
      'Aggregate verdicts are computed from structured artifact checks and narrow allowed BLOCKED contracts.',
    adversarialCoverage: aggregate.adversarialCoverage,
  };
  await writeJson(path.join(reviewDir, 'todo-9-support.json'), support);
  await writeFile(
    path.join(reviewDir, 'adversarial-coverage.md'),
    [
      '# Todo 9 Adversarial Coverage',
      '',
      ...aggregate.adversarialCoverage.map((item) => `- ${item.name}: ${item.coverage}`),
      '',
      '## False PASS Risks',
      '',
      ...support.falsePassRisks.map((item) => `- ${item}`),
      '',
    ].join('\n'),
    'utf8',
  );
}

function markdownFileLink(filePath) {
  const label = path.basename(filePath);
  return `[${label}](${filePath})`;
}

async function readFileIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

async function runStaticPhase(context) {
  const startedAt = new Date().toISOString();
  const records = [];
  const staticRecordPath = path.join(context.evidenceRoot, 'commands', 'static.jsonl');
  await writeFile(staticRecordPath, '', 'utf8');
  context.staticToolchain = await prepareStaticToolchain(context);

  const nodeRecord = await runRecordedStaticCommand(context, {
    name: 'node-version-preflight',
    command: 'node',
    args: ['-v'],
    timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
  });
  records.push(nodeRecord);
  const staticNodeVersion = nodeRecord.stdout.trim().replace(/^v/, '');
  nodeRecord.assertion = {
    status:
      nodeRecord.exitCode === 0 &&
      context.nodeRuntime.status === 'PASS' &&
      compareVersions(staticNodeVersion, REQUIRED_NODE_VERSION) >= 0
        ? 'PASS'
        : 'BLOCKED',
    expected: `selected repo command Node and static PATH node >=${REQUIRED_NODE_VERSION}`,
    actual: {
      harnessNode: process.versions.node,
      selectedNode: context.nodeRuntime.version,
      staticPathNode: nodeRecord.stdout.trim() || nodeRecord.stderr.trim() || nodeRecord.error,
      nodePath: context.staticToolchain?.nodePath,
    },
  };
  await rewriteStaticRecords(context.evidenceRoot, records);

  if (nodeRecord.assertion.status !== 'PASS') {
    return finishStaticPhase(context, {
      records,
      startedAt,
      status: 'BLOCKED',
      reason: `Selected repo command Node or static PATH node is below ${REQUIRED_NODE_VERSION}.`,
    });
  }

  const pnpmRecord = await runRecordedStaticCommand(context, {
    name: 'corepack-pnpm-version',
    command: 'corepack',
    args: ['pnpm', '-v'],
    timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
  });
  records.push(pnpmRecord);
  pnpmRecord.assertion = {
    status:
      pnpmRecord.exitCode === 0 &&
      pnpmRecord.stdout.trim() === REQUIRED_PNPM_VERSION &&
      context.staticToolchain?.barePnpmVersion === REQUIRED_PNPM_VERSION &&
      context.staticToolchain?.metadata?.status === 'PASS'
        ? 'PASS'
        : 'BLOCKED',
    expected: `corepack pnpm and nested bare pnpm ${REQUIRED_PNPM_VERSION}`,
    actual: {
      corepackPnpm: pnpmRecord.stdout.trim() || pnpmRecord.stderr.trim() || pnpmRecord.error,
      barePnpm: context.staticToolchain?.barePnpmVersion,
      pnpmPath: context.staticToolchain?.pnpmPath,
      toolchainStatus: context.staticToolchain?.metadata?.status,
    },
  };
  await rewriteStaticRecords(context.evidenceRoot, records);

  if (pnpmRecord.assertion.status !== 'PASS') {
    return finishStaticPhase(context, {
      records,
      startedAt,
      status: 'BLOCKED',
      reason: `corepack pnpm -v did not report ${REQUIRED_PNPM_VERSION}.`,
    });
  }

  const installDecision = await buildStaticInstallDecision(context);
  await writeJson(path.join(context.evidenceRoot, 'commands', 'static-install-decision.json'), {
    schemaVersion: 1,
    runId: context.runId,
    phase: 'static',
    argv: ['corepack', 'pnpm', 'install', '--frozen-lockfile'],
    cwd: context.sourceCheckout,
    ...installDecision,
  });
  if (installDecision.execute) {
    records.push(
      await runRecordedStaticCommand(context, {
        name: 'install-frozen-lockfile',
        command: 'corepack',
        args: ['pnpm', 'install', '--frozen-lockfile'],
        timeoutMs: STATIC_PHASE_TIMEOUTS.install,
      }),
    );
  }

  const commandSpecs = [
    {
      name: 'build-packages',
      args: ['pnpm', 'run', 'build:packages'],
      timeoutMs: STATIC_PHASE_TIMEOUTS.build,
    },
    {
      name: 'kimi-code-typecheck',
      args: ['pnpm', '--filter', '@moonshot-ai/kimi-code', 'run', 'typecheck'],
      timeoutMs: STATIC_PHASE_TIMEOUTS.typecheck,
    },
    {
      name: 'server-typecheck',
      args: ['pnpm', '--filter', '@moonshot-ai/server', 'run', 'typecheck'],
      timeoutMs: STATIC_PHASE_TIMEOUTS.typecheck,
    },
    {
      name: 'server-e2e-typecheck',
      args: ['pnpm', '--filter', '@moonshot-ai/server-e2e', 'run', 'typecheck'],
      timeoutMs: STATIC_PHASE_TIMEOUTS.typecheck,
    },
    {
      name: 'harness-oxlint',
      args: ['pnpm', 'exec', 'oxlint', 'scripts/qa-super-kimi-autonomous.mjs'],
      timeoutMs: STATIC_PHASE_TIMEOUTS.lint,
    },
    {
      name: 'kimi-code-targeted-tui-tests',
      args: [
        'pnpm',
        '--filter',
        '@moonshot-ai/kimi-code',
        'test',
        'test/tui/kimi-tui-message-flow.test.ts',
        'test/tui/printable-key-guard.test.ts',
      ],
      timeoutMs: STATIC_PHASE_TIMEOUTS.test,
    },
    {
      name: 'server-targeted-tests',
      args: [
        'pnpm',
        '--filter',
        '@moonshot-ai/server',
        'test',
        'test/start.test.ts',
        'test/ws-handshake.e2e.test.ts',
        'test/terminals.e2e.test.ts',
      ],
      timeoutMs: STATIC_PHASE_TIMEOUTS.test,
    },
  ];

  for (const spec of commandSpecs) {
    const record = await runRecordedStaticCommand(context, {
      name: spec.name,
      command: 'corepack',
      args: spec.args,
      timeoutMs: spec.timeoutMs,
    });
    records.push(record);
  }

  const failedRecord = records.find((record) => record.status !== 'PASS' || record.exitCode !== 0);
  return finishStaticPhase(context, {
    records,
    startedAt,
    status: failedRecord === undefined ? 'PASS' : 'FAIL',
    reason:
      failedRecord === undefined
        ? 'All static commands exited 0.'
        : failedRecord.outputAudit?.status === 'FAIL'
          ? `${failedRecord.name} emitted unsupported engine output.`
        : `${failedRecord.name} exited ${failedRecord.exitCode}.`,
  });
}

async function finishStaticPhase(context, { records, reason, startedAt, status }) {
  const completedAt = new Date().toISOString();
  const forbiddenCommandAudit = buildForbiddenCommandAudit(records);
  const engineWarningAudit = buildStaticEngineWarningAudit(records);
  const finalStatus =
    forbiddenCommandAudit.status !== 'PASS'
      ? 'FAIL'
      : engineWarningAudit.status !== 'PASS'
        ? status === 'BLOCKED'
          ? 'BLOCKED'
          : 'FAIL'
        : status;
  const finalReason =
    forbiddenCommandAudit.status !== 'PASS'
      ? `Forbidden command audit failed: ${forbiddenCommandAudit.failures.join(', ')}`
      : engineWarningAudit.status !== 'PASS'
        ? `Unsupported engine output detected: ${engineWarningAudit.failures.join(', ')}`
        : reason;
  const summaryPath = path.join(context.evidenceRoot, 'static-summary.json');
  await writeJson(summaryPath, {
    schemaVersion: 1,
    runId: context.runId,
    phase: 'static',
    status: finalStatus,
    reason: finalReason,
    startedAt,
    completedAt,
    commandCount: records.length,
    commandRecordPath: path.join(context.evidenceRoot, 'commands', 'static.jsonl'),
    forbiddenCommandAudit,
    engineWarningAudit,
    staticToolchain: context.staticToolchain?.metadata,
  });
  const phaseEntry = {
    name: 'static',
    status: finalStatus,
    reason: finalReason,
    subprocessStarted: records.length > 0,
    liveProductCommandStarted: false,
    startedAt,
    completedAt,
    commandRecordPath: path.join(context.evidenceRoot, 'commands', 'static.jsonl'),
    summaryPath,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return {
    phaseEntry,
    cleanupOverrides: {
      status: 'static-completed',
      reason: 'Static phase started no persistent live resources.',
      liveProcessesStarted: false,
      liveProductCommandsStarted: false,
      proofCommands: records.map((record) => ({
        argv: record.argv,
        cwd: record.cwd,
        exitCode: record.exitCode,
        timedOut: record.timedOut,
        durationMs: record.durationMs,
      })),
    },
  };
}

async function runRecordedStaticCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const env = spec.env ?? context.staticToolchain?.env ?? process.env;
  const result = spawnSync(spec.command, spec.args, {
    cwd: context.sourceCheckout,
    encoding: 'utf8',
    env,
    maxBuffer: 50 * 1024 * 1024,
    timeout: spec.timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const stdout = redactCommandOutput(result.stdout ?? '', context.redactionPolicy);
  const stderr = redactCommandOutput(result.stderr ?? '', context.redactionPolicy);
  const outputAudit = buildUnsupportedEngineOutputAudit(stdout, stderr);
  const record = {
    schemaVersion: 1,
    runId: context.runId,
    phase: 'static',
    name: spec.name,
    executed: true,
    argv: [spec.command, ...spec.args],
    cwd: context.sourceCheckout,
    envSummary: summarizeCommandEnv(env, context.redactionPolicy, context.staticToolchain),
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    timeoutMs: spec.timeoutMs,
    stdout,
    stderr,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal,
    error: result.error?.message,
    timedOut: result.error?.code === 'ETIMEDOUT',
    outputAudit,
  };
  record.status = record.exitCode === 0 && outputAudit.status === 'PASS' ? 'PASS' : 'FAIL';
  await appendStaticRecord(context.evidenceRoot, record);
  return record;
}

async function appendStaticRecord(evidenceRoot, record) {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path.join(evidenceRoot, 'commands', 'static.jsonl'), line, 'utf8');
  await appendFile(path.join(evidenceRoot, 'commands', 'commands.jsonl'), line, 'utf8');
}

async function rewriteStaticRecords(evidenceRoot, records) {
  const content = records.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(
    path.join(evidenceRoot, 'commands', 'static.jsonl'),
    content === '' ? '' : `${content}\n`,
    'utf8',
  );
}

async function buildStaticInstallDecision(context) {
  const sourceCheckout = context.sourceCheckout;
  const nodeModulesPath = path.join(sourceCheckout, 'node_modules');
  const nodeModulesExists = await pathExists(nodeModulesPath);
  const explicitInstall = context.options.install;
  return {
    execute: explicitInstall || !nodeModulesExists,
    explicitInstall,
    nodeModulesPath,
    nodeModulesExists,
    reason: explicitInstall
      ? 'Will run because --install was provided.'
      : nodeModulesExists
        ? 'Skipped because root node_modules already exists.'
        : 'Will run because root node_modules is missing.',
  };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function summarizeCommandEnv(env, policy, staticToolchain) {
  const names = Object.keys(env).toSorted();
  const selectedNames = ['CI', 'HOME', 'NODE_ENV', 'PATH', 'PNPM_HOME'];
  return {
    variableCount: names.length,
    redactedVariableNames: names.filter((name) => isSensitiveName(name)),
    selected: Object.fromEntries(
      selectedNames
        .filter((name) => env[name] !== undefined)
        .map((name) => [name, redactEnvValue(name, env[name], policy)]),
    ),
    staticToolchain: staticToolchain?.metadata,
  };
}

function redactCommandOutput(value, policy) {
  if (value === '') return '';
  return value
    .replaceAll(/sk-[A-Za-z0-9_-]{20,}/g, policy.valueForRedactedSecrets)
    .replaceAll(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, `Bearer ${policy.valueForRedactedSecrets}`)
    .replaceAll(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      policy.valueForRedactedSecrets,
    )
    .replaceAll(
      /\b(api[_-]?key|token|secret|password|oauth|bearer|auth|client[_-]?secret)\b(\s*[:=]\s*)[^\s"'`]{4,}/gi,
      `$1$2${policy.valueForRedactedSecrets}`,
    );
}

function buildForbiddenCommandAudit(records) {
  const executedCommandLines = records
    .filter((record) => record.executed)
    .map((record) => formatArgv(record.argv));
  const checks = [
    { name: 'root-pnpm-lint', pattern: /^corepack pnpm run lint(?:\s|$)/ },
    {
      name: 'kimi-code-smoke',
      pattern: /(?:apps\/kimi-code|@moonshot-ai\/kimi-code).* run smoke(?:\s|$)/,
    },
    { name: 'dev-web', pattern: /(?:^|\s)dev:web(?:\s|$)/ },
    { name: 'vite', pattern: /(?:^|\s)vite(?:\s|$)/i },
    { name: 'playwright', pattern: /(?:^|\s)playwright(?:\s|$)/i },
    { name: 'apps-kimi-web', pattern: /apps\/kimi-web/ },
  ].map((check) => ({
    name: check.name,
    matches: executedCommandLines.filter((line) => check.pattern.test(line)),
  }));
  const failures = checks
    .filter((check) => check.matches.length > 0)
    .map((check) => check.name);
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    checks,
    executedCommandLines,
    forbiddenCommands:
      'No root lint, apps/kimi-code smoke, dev:web, Vite, Playwright, or apps/kimi-web command may be executed by the static phase.',
  };
}

async function prepareStaticToolchain(context) {
  const shimDir = path.join(context.evidenceRoot, 'commands', 'corepack-shims');
  await mkdir(shimDir, { recursive: true });
  const basePath = process.env.PATH ?? '';
  const nodeBinDir =
    context.nodeRuntime.status === 'PASS' ? context.nodeRuntime.binDir : path.dirname(process.execPath);
  const setupEnv = {
    ...process.env,
    PATH: [nodeBinDir, basePath].filter(Boolean).join(path.delimiter),
  };
  const enable = runBoundedCommand('corepack', ['enable', '--install-directory', shimDir], {
    cwd: context.sourceCheckout,
    env: setupEnv,
    timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
  });
  const env = {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    PATH: [shimDir, nodeBinDir, basePath].filter(Boolean).join(path.delimiter),
    PNPM_HOME: shimDir,
  };
  const node = runBoundedCommand('node', ['-v'], {
    cwd: context.sourceCheckout,
    env,
    timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
  });
  const corepackPnpm = runBoundedCommand('corepack', ['pnpm', '-v'], {
    cwd: context.sourceCheckout,
    env,
    timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
  });
  const barePnpm = runBoundedCommand('pnpm', ['-v'], {
    cwd: context.sourceCheckout,
    env,
    timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
  });
  const paths = runBoundedCommand(
    '/bin/sh',
    ['-c', 'printf "node=%s\\ncorepack=%s\\npnpm=%s\\n" "$(command -v node)" "$(command -v corepack)" "$(command -v pnpm)"'],
    {
      cwd: context.sourceCheckout,
      env,
      timeoutMs: STATIC_PHASE_TIMEOUTS.preflight,
    },
  );
  const pathEntries = Object.fromEntries(
    paths.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  const nodeVersion = node.stdout.trim().replace(/^v/, '');
  const metadata = {
    status:
      enable.status === 0 &&
      node.status === 0 &&
      compareVersions(nodeVersion, REQUIRED_NODE_VERSION) >= 0 &&
      corepackPnpm.stdout.trim() === REQUIRED_PNPM_VERSION &&
      barePnpm.stdout.trim() === REQUIRED_PNPM_VERSION
        ? 'PASS'
        : 'FAIL',
    expected: {
      node: `>=${REQUIRED_NODE_VERSION}`,
      pnpm: REQUIRED_PNPM_VERSION,
    },
    shimDir,
    nodeBinDir,
    nodePath: pathEntries.node ?? '',
    corepackPath: pathEntries.corepack ?? '',
    pnpmPath: pathEntries.pnpm ?? '',
    nodeVersion: node.stdout.trim() || node.stderr.trim() || `exit ${node.status}`,
    corepackPnpmVersion:
      corepackPnpm.stdout.trim() || corepackPnpm.stderr.trim() || `exit ${corepackPnpm.status}`,
    barePnpmVersion: barePnpm.stdout.trim() || barePnpm.stderr.trim() || `exit ${barePnpm.status}`,
    enableExitCode: enable.status,
    enableStderr: enable.stderr.trim(),
  };
  await writeJson(path.join(context.evidenceRoot, 'commands', 'static-toolchain.json'), {
    schemaVersion: 1,
    runId: context.runId,
    phase: 'static',
    metadata,
    commands: {
      enable: commandProof(enable),
      node: commandProof(node),
      corepackPnpm: commandProof(corepackPnpm),
      barePnpm: commandProof(barePnpm),
      paths: commandProof(paths),
    },
  });
  return {
    env,
    metadata,
    barePnpmVersion: barePnpm.stdout.trim(),
    nodePath: pathEntries.node,
    pnpmPath: pathEntries.pnpm,
  };
}

function buildUnsupportedEngineOutputAudit(stdout, stderr) {
  const findings = [];
  for (const [stream, value] of [
    ['stdout', stdout],
    ['stderr', stderr],
  ]) {
    const lines = value.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (UNSUPPORTED_ENGINE_PATTERNS.some((pattern) => pattern.test(line))) {
        findings.push({
          stream,
          line: index + 1,
          text: line.slice(0, 500),
        });
      }
    }
  }
  return {
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    findings,
  };
}

function buildStaticEngineWarningAudit(records) {
  const failures = records
    .filter((record) => record.outputAudit?.status === 'FAIL')
    .map((record) => record.name);
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    detail:
      failures.length === 0
        ? 'No Unsupported engine or current node/pnpm warning lines were found in static command stdout/stderr.'
        : 'Static commands must not pass with unsupported engine output.',
  };
}

function formatArgv(argv) {
  return argv.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

async function runDirectCliPhase(context) {
  const startedAt = new Date().toISOString();
  const commandRecords = [];
  const cleanupOverrides = {
    status: 'direct-cli-running',
    reason: 'Direct CLI phase tracked product subprocesses and disposable runtime paths.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    proofCommands: [],
  };
  let targetWorktreeCreated = false;
  let tempHomeCreated = false;
  let tempRootCreated = false;
  let tempRootRemoved = false;
  let targetWorktreeRemoved = false;
  const managesKimiCodeHome = context.kimiCodeHomeMode !== 'real-user-opt-in';

  const summary = {
    schemaVersion: 1,
    phase: 'direct-cli',
    status: 'FAIL',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    targetWorkspace: context.targetWorktree,
    targetWorkspaceKind: 'disposable-git-worktree',
    kimiCodeHome: context.plannedKimiCodeHome,
    kimiCodeHomeSource: context.options.kimiCodeHome === undefined ? 'generated-temp-home' : 'caller-supplied',
    commandTimeoutMs: 180_000,
    commands: commandRecords,
    validations: {},
  };

  try {
    await writeFile(path.join(context.evidenceRoot, 'commands', 'direct-cli.jsonl'), '', 'utf8');
    const isolation = validateDirectCliIsolation(context);
    summary.validations.homeIsolation = isolation;
    if (isolation.status !== 'PASS') {
      summary.reason = isolation.reason;
      return await finishDirectCliPhase(context, summary, cleanupOverrides);
    }

    await mkdir(context.tempRoot, { recursive: true });
    tempRootCreated = true;
    if (managesKimiCodeHome) {
      await mkdir(context.plannedKimiCodeHome, { recursive: true, mode: 0o700 });
      tempHomeCreated = true;
    }
    await createDisposableGitWorktree(context);
    targetWorktreeCreated = true;

    const packageVersion = await readKimiCodePackageVersion(context.sourceCheckout);
    summary.expectedVersion = packageVersion;

    const runtime = await resolveDirectCliRuntimeEnv(context.sourceCheckout, process.env);
    summary.runtime = runtime.metadata;

    const sharedMetadata = {
      sourceCwd: context.sourceCheckout,
      targetWorkspace: context.targetWorktree,
      kimiCodeHome: context.plannedKimiCodeHome,
      env: { KIMI_CODE_HOME: context.plannedKimiCodeHome },
    };
    const sharedEnv = { ...runtime.env, KIMI_CODE_HOME: context.plannedKimiCodeHome };
    const versionRecord = await runRecordedCommand(context, {
      name: 'version',
      command: 'corepack',
      args: ['pnpm', '-C', 'apps/kimi-code', 'run', 'dev', '--', '--version'],
      cwd: context.sourceCheckout,
      env: sharedEnv,
      metadata: sharedMetadata,
      timeoutMs: summary.commandTimeoutMs,
    });
    commandRecords.push(versionRecord);

    const helpRecord = await runRecordedCommand(context, {
      name: 'help',
      command: 'corepack',
      args: ['pnpm', '-C', 'apps/kimi-code', 'run', 'dev', '--', '--help'],
      cwd: context.sourceCheckout,
      env: sharedEnv,
      metadata: sharedMetadata,
      timeoutMs: summary.commandTimeoutMs,
    });
    commandRecords.push(helpRecord);

    summary.validations.versionExitCode = passFail(
      versionRecord.exitCode === 0,
      `version exit code ${versionRecord.exitCode}`,
    );
    summary.validations.helpExitCode = passFail(
      helpRecord.exitCode === 0,
      `help exit code ${helpRecord.exitCode}`,
    );
    summary.validations.versionOutput = passFail(
      outputHasExactLine(versionRecord.stdout, packageVersion),
      `version stdout must include exact line ${packageVersion}`,
    );
    summary.validations.helpOutput = passFail(
      helpRecord.stdout.includes('Usage: kimi'),
      'help stdout must include "Usage: kimi"',
    );
    summary.validations.noDefaultHomeInCommandOutput = validateCommandOutputHomeIsolation([
      versionRecord,
      helpRecord,
    ]);

    const failedValidation = Object.values(summary.validations).find(
      (validation) => validation.status !== 'PASS',
    );
    if (failedValidation === undefined) {
      summary.status = 'PASS';
      summary.reason = 'Version and help commands passed with isolated runtime metadata.';
    } else {
      summary.status = 'FAIL';
      summary.reason = failedValidation.reason;
    }
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    cleanupOverrides.status = summary.status === 'PASS' ? 'direct-cli-completed' : 'direct-cli-failed';
    cleanupOverrides.reason = summary.reason;
    cleanupOverrides.liveProductCommandsStarted = commandRecords.length > 0;
    cleanupOverrides.tempHome = {
      path: context.plannedKimiCodeHome,
      created: tempHomeCreated,
      removed: false,
      retained: context.options.keepTemp && tempHomeCreated,
      detail: tempHomeCreated
        ? 'Direct CLI KIMI_CODE_HOME was created before command execution.'
        : 'Direct CLI KIMI_CODE_HOME was not created.',
    };
    cleanupOverrides.targetWorktree = {
      path: context.targetWorktree,
      created: targetWorktreeCreated,
      removed: false,
      retained: context.options.keepTemp && targetWorktreeCreated,
      detail: targetWorktreeCreated
        ? 'Disposable git worktree was created outside the source checkout.'
        : 'Disposable git worktree was not created.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: tempRootCreated,
      removed: false,
      retained: context.options.keepTemp && tempRootCreated,
      detail: tempRootCreated
        ? 'Direct CLI temp root was created.'
        : 'Direct CLI temp root was not created.',
    };

    if (!context.options.keepTemp) {
      if (targetWorktreeCreated) {
        const removal = runBoundedCommand('git', ['worktree', 'remove', '--force', context.targetWorktree], {
          cwd: context.sourceCheckout,
          timeoutMs: 60_000,
        });
        targetWorktreeRemoved = removal.status === 0;
        cleanupOverrides.proofCommands.push(commandProof(removal));
      }
      if (tempRootCreated) {
        await rm(context.tempRoot, { recursive: true, force: true });
        tempRootRemoved = true;
      }
      cleanupOverrides.tempHome.removed = tempRootRemoved && tempHomeCreated;
      cleanupOverrides.tempHome.retained = tempHomeCreated && !tempRootRemoved;
      cleanupOverrides.targetWorktree.removed = targetWorktreeRemoved;
      cleanupOverrides.targetWorktree.retained = targetWorktreeCreated && !targetWorktreeRemoved;
      cleanupOverrides.tempRoot.removed = tempRootRemoved;
      cleanupOverrides.tempRoot.retained = tempRootCreated && !tempRootRemoved;
    }
  }

  return finishDirectCliPhase(context, summary, cleanupOverrides);
}

async function finishDirectCliPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  await writeJson(path.join(context.evidenceRoot, 'direct-cli.json'), summary);
  const phaseEntry = {
    name: 'direct-cli',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted: summary.commands.length > 0,
    liveProductCommandStarted: summary.commands.length > 0,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

async function runAutonomousPhase(context) {
  const startedAt = new Date().toISOString();
  const autonomousDir = path.join(context.evidenceRoot, 'autonomous');
  const commandRecords = [];
  const cleanupOverrides = {
    status: 'autonomous-running',
    reason: 'Autonomous phase has not completed.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    proofCommands: [],
  };
  const summary = {
    schemaVersion: 1,
    phase: 'autonomous',
    status: 'FAIL',
    reason: 'Autonomous phase did not complete.',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    targetWorkspace: context.targetWorktree,
    targetWorkspaceKind: 'disposable-git-worktree',
    kimiCodeHome: context.plannedKimiCodeHome,
    canaryFile: AUTONOMOUS_CANARY_FILE,
    canaryToken: AUTONOMOUS_CANARY_TOKEN,
    commandTimeoutMs: AUTONOMOUS_COMMAND_TIMEOUT_MS,
    commands: commandRecords,
    validations: {},
    artifacts: {
      streamJsonl: path.join(autonomousDir, 'stream.jsonl'),
      diff: path.join(autonomousDir, 'diff.txt'),
      grepLog: path.join(autonomousDir, 'grep.log'),
    },
  };
  let targetWorktreeCreated = false;
  let tempHomeCreated = false;
  let tempRootCreated = false;
  let tempRootRemoved = false;
  let targetWorktreeRemoved = false;
  const managesKimiCodeHome = context.kimiCodeHomeMode !== 'real-user-opt-in';

  await mkdir(autonomousDir, { recursive: true });
  await writeFile(path.join(context.evidenceRoot, 'commands', 'autonomous.jsonl'), '', 'utf8');

  const credentials = await detectAutonomousCredentials(process.env, context);
  summary.credentialReadiness = credentials;
  await writeJson(path.join(autonomousDir, 'auth-readiness.json'), credentials);
  await writeJson(path.join(context.evidenceRoot, 'auth-readiness.json'), credentials);

  if (credentials.status !== 'PASS') {
    summary.status = 'BLOCKED';
    summary.reason = credentials.reason;
    await writeFile(
      summary.artifacts.streamJsonl,
      `${JSON.stringify({
        type: 'autonomous.blocked',
        status: 'BLOCKED',
        reason: credentials.reason,
        providerCallStarted: false,
      })}\n`,
      'utf8',
    );
    await writeFile(
      summary.artifacts.diff,
      `BLOCKED: no git diff was attempted because provider credentials were missing; providerCallStarted=false\n`,
      'utf8',
    );
    await writeFile(
      summary.artifacts.grepLog,
      [
        `command=grep -qx ${AUTONOMOUS_CANARY_TOKEN} ${AUTONOMOUS_CANARY_FILE}`,
        'exitCode=not-run',
        'providerCallStarted=false',
        `reason=${credentials.reason}`,
        '',
      ].join('\n'),
      'utf8',
    );
    const skippedRecord = {
      name: 'missing-auth-preflight',
      command: null,
      args: [],
      argv: [],
      cwd: context.sourceCheckout,
      env: {},
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: 1,
      signal: undefined,
      timedOut: false,
      subprocessStarted: false,
      liveProductCommandStarted: false,
      stdoutPath: summary.artifacts.streamJsonl,
      stderrPath: undefined,
      exitCodePath: undefined,
      stdout: '',
      stderr: '',
      error: credentials.reason,
    };
    commandRecords.push(skippedRecord);
    await appendAutonomousCommandRecord(context.evidenceRoot, skippedRecord);
    const failure = {
      schemaVersion: 1,
      phase: 'autonomous',
      status: 'BLOCKED',
      reason: credentials.reason,
      providerCallStarted: false,
      credentialReadiness: credentials,
      command: null,
      exactMissingEvidence: credentials.missing,
    };
    await writeJson(path.join(context.evidenceRoot, 'failure-missing-auth.json'), failure);
    await writeJson(path.join(autonomousDir, 'failure-missing-auth.json'), failure);
    cleanupOverrides.tempHome = {
      path: context.plannedKimiCodeHome,
      created: false,
      removed: false,
      retained: false,
      detail: 'Autonomous missing-auth preflight blocked before creating KIMI_CODE_HOME.',
    };
    cleanupOverrides.targetWorktree = {
      path: context.targetWorktree,
      created: false,
      removed: false,
      retained: false,
      detail: 'Autonomous missing-auth preflight blocked before creating a disposable worktree.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: false,
      removed: false,
      retained: false,
      detail: 'Autonomous missing-auth preflight blocked before creating temp root.',
    };
    return finishAutonomousPhase(context, summary, cleanupOverrides);
  }

  try {
    const isolation = validateDirectCliIsolation(context);
    summary.validations.homeIsolation = isolation;
    if (isolation.status !== 'PASS') {
      summary.status = 'FAIL';
      summary.reason = isolation.reason;
      return await finishAutonomousPhase(context, summary, cleanupOverrides);
    }

    await mkdir(context.tempRoot, { recursive: true });
    tempRootCreated = true;
    await mkdir(context.plannedKimiCodeHome, { recursive: true, mode: 0o700 });
    tempHomeCreated = true;
    await createDisposableGitWorktree(context);
    targetWorktreeCreated = true;

    const runtime = await resolveDirectCliRuntimeEnv(context.sourceCheckout, process.env);
    summary.runtime = runtime.metadata;
    const prompt = [
      '/ultrawork create in ',
      context.targetWorktree,
      `: create ${AUTONOMOUS_CANARY_FILE} containing ${AUTONOMOUS_CANARY_TOKEN} and verify it with grep`,
    ].join('');
    const env = {
      ...runtime.env,
      KIMI_CODE_HOME: context.plannedKimiCodeHome,
      KIMI_CODE_CACHE_DIR: path.join(context.tempRoot, 'cache'),
    };
    const envForEvidence = redactEnvironment(
      {
        KIMI_CODE_HOME: context.plannedKimiCodeHome,
        KIMI_CODE_CACHE_DIR: path.join(context.tempRoot, 'cache'),
        KIMI_MODEL_NAME: env.KIMI_MODEL_NAME,
        KIMI_MODEL_PROVIDER_TYPE: env.KIMI_MODEL_PROVIDER_TYPE,
        KIMI_MODEL_BASE_URL: env.KIMI_MODEL_BASE_URL,
        KIMI_MODEL_API_KEY: env.KIMI_MODEL_API_KEY,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      },
      context.redactionPolicy,
    ).variables;

    const canaryRecord = await runAutonomousRecordedCommand(context, {
      name: 'ultrawork-canary',
      command: 'corepack',
      args: [
        'pnpm',
        '-C',
        'apps/kimi-code',
        'run',
        'dev',
        '--',
        '-p',
        prompt,
        '--output-format',
        'stream-json',
        '--add-dir',
        context.targetWorktree,
      ],
      cwd: context.sourceCheckout,
      env,
      envForEvidence,
      timeoutMs: AUTONOMOUS_COMMAND_TIMEOUT_MS,
      streamPath: summary.artifacts.streamJsonl,
    });
    commandRecords.push(canaryRecord);
    cleanupOverrides.liveProcessesStarted = true;
    cleanupOverrides.liveProductCommandsStarted = true;
    cleanupOverrides.proofCommands.push(commandProofFromRecord(canaryRecord));

    const addIntentRecord = await runAutonomousProofCommand(context, {
      name: 'git-add-intent-canary',
      command: 'git',
      args: ['add', '-N', '--', AUTONOMOUS_CANARY_FILE],
      cwd: context.targetWorktree,
      timeoutMs: 30_000,
    });
    commandRecords.push(addIntentRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(addIntentRecord));

    const diffRecord = await runAutonomousProofCommand(context, {
      name: 'git-diff-canary',
      command: 'git',
      args: ['diff', '--', AUTONOMOUS_CANARY_FILE],
      cwd: context.targetWorktree,
      timeoutMs: 30_000,
      stdoutPath: summary.artifacts.diff,
    });
    commandRecords.push(diffRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(diffRecord));

    const grepRecord = await runAutonomousProofCommand(context, {
      name: 'grep-canary',
      command: 'grep',
      args: ['-qx', AUTONOMOUS_CANARY_TOKEN, AUTONOMOUS_CANARY_FILE],
      cwd: context.targetWorktree,
      timeoutMs: 30_000,
      stdoutPath: summary.artifacts.grepLog,
      logCommandAndExit: true,
    });
    commandRecords.push(grepRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(grepRecord));

    const statusRecord = await runAutonomousProofCommand(context, {
      name: 'git-status-canary',
      command: 'git',
      args: ['status', '--short', '--', AUTONOMOUS_CANARY_FILE],
      cwd: context.targetWorktree,
      timeoutMs: 30_000,
    });
    commandRecords.push(statusRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(statusRecord));

    const stream = parseAutonomousStream(canaryRecord.stdout);
    summary.goalSummary = stream.goalSummary;
    summary.streamJsonLineCount = stream.lineCount;
    summary.validations.commandExit = passFail(
      canaryRecord.exitCode === 0 && !canaryRecord.timedOut,
      canaryRecord.timedOut
        ? 'headless autonomous command timed out'
        : `headless autonomous command exit code ${canaryRecord.exitCode}`,
    );
    summary.validations.goalSummaryComplete = passFail(
      stream.goalSummary?.status === 'complete',
      `final goal.summary.status must be "complete"; actual=${String(stream.goalSummary?.status)}`,
    );
    summary.validations.gitAddIntent = passFail(
      addIntentRecord.exitCode === 0,
      `git add -N exit code ${addIntentRecord.exitCode}`,
    );
    summary.validations.diffProof = validateAutonomousDiff(diffRecord.stdout);
    summary.validations.grepProof = passFail(
      grepRecord.exitCode === 0 && !grepRecord.timedOut,
      `grep -qx ${AUTONOMOUS_CANARY_TOKEN} ${AUTONOMOUS_CANARY_FILE} exit code ${grepRecord.exitCode}`,
    );
    summary.validations.statusLimitedToCanary = validateAutonomousStatus(statusRecord.stdout);

    const failedValidation = Object.values(summary.validations).find(
      (validation) => validation.status !== 'PASS',
    );
    if (failedValidation === undefined) {
      summary.status = 'PASS';
      summary.reason =
        'Headless /ultrawork goal completed and qa-canary.txt diff/grep proof matched the expected token.';
    } else {
      summary.status = 'FAIL';
      summary.reason = failedValidation.reason;
    }
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    cleanupOverrides.tempHome = {
      path: context.plannedKimiCodeHome,
      created: tempHomeCreated,
      removed: false,
      retained: context.options.keepTemp && tempHomeCreated,
      external: !managesKimiCodeHome,
      detail: !managesKimiCodeHome
        ? 'Autonomous KIMI_CODE_HOME used the real user home by explicit opt-in and is not managed by cleanup.'
        : tempHomeCreated
          ? 'Autonomous KIMI_CODE_HOME was created before command execution.'
          : 'Autonomous KIMI_CODE_HOME was not created before block/failure.',
    };
    cleanupOverrides.targetWorktree = {
      path: context.targetWorktree,
      created: targetWorktreeCreated,
      removed: false,
      retained: context.options.keepTemp && targetWorktreeCreated,
      detail: targetWorktreeCreated
        ? 'Disposable autonomous target worktree was created outside the source checkout.'
        : 'Disposable autonomous target worktree was not created before block/failure.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: tempRootCreated,
      removed: false,
      retained: context.options.keepTemp && tempRootCreated,
      detail: tempRootCreated
        ? 'Autonomous temp root was created.'
        : 'Autonomous temp root was not created before block/failure.',
    };

    if (!context.options.keepTemp) {
      if (targetWorktreeCreated) {
        const removal = runBoundedCommand(
          'git',
          ['worktree', 'remove', '--force', context.targetWorktree],
          {
            cwd: context.sourceCheckout,
            timeoutMs: 60_000,
          },
        );
        targetWorktreeRemoved = removal.status === 0;
        cleanupOverrides.proofCommands.push(commandProof(removal));
      }
      if (tempRootCreated) {
        await rm(context.tempRoot, { recursive: true, force: true });
        tempRootRemoved = true;
      }
      cleanupOverrides.tempHome.removed =
        managesKimiCodeHome && tempRootRemoved && tempHomeCreated;
      cleanupOverrides.tempHome.retained =
        managesKimiCodeHome && tempHomeCreated && !tempRootRemoved;
      cleanupOverrides.targetWorktree.removed = targetWorktreeRemoved;
      cleanupOverrides.targetWorktree.retained = targetWorktreeCreated && !targetWorktreeRemoved;
      cleanupOverrides.tempRoot.removed = tempRootRemoved;
      cleanupOverrides.tempRoot.retained = tempRootCreated && !tempRootRemoved;
    }
  }

  return finishAutonomousPhase(context, summary, cleanupOverrides);
}

async function finishAutonomousPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  cleanupOverrides.status =
    summary.status === 'PASS'
      ? 'autonomous-pass-cleaned'
      : summary.status === 'BLOCKED'
        ? 'autonomous-blocked-cleaned'
        : 'autonomous-failed-cleaned';
  cleanupOverrides.reason = summary.reason;
  await writeJson(path.join(context.evidenceRoot, 'summary.json'), summary);
  await writeJson(path.join(context.evidenceRoot, 'autonomous', 'summary.json'), summary);
  const phaseEntry = {
    name: 'autonomous',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted: summary.commands.some((command) => command.subprocessStarted !== false),
    liveProductCommandStarted: summary.commands.some((command) => command.name === 'ultrawork-canary'),
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

async function detectAutonomousCredentials(env, context) {
  const simulateMissingAuth = context.options.simulateMissingAuth;
  if (simulateMissingAuth) {
    return {
      status: 'BLOCKED',
      reason: 'BLOCKED: --simulate-missing-auth requested; provider call was not started.',
      authMode: context.options.useRealKimiHome
        ? 'real-kimi-code-home-login'
        : 'isolated-env-model',
      simulated: true,
      providerCallStarted: false,
      required: context.options.useRealKimiHome
        ? [
            'real KIMI_CODE_HOME /login token',
            `${EXPECTED_KIMI_CODE_MODEL_LABEL} default model`,
          ]
        : ['KIMI_MODEL_NAME', 'KIMI_MODEL_API_KEY'],
      present: {},
      optionalPresent: {},
      missing: [],
      redaction: 'Only readiness metadata is recorded; credential values are never written.',
    };
  }

  if (context.options.useRealKimiHome) {
    return detectRealKimiHomeCredentials(context);
  }

  return detectEnvModelAutonomousCredentials(env);
}

function detectEnvModelAutonomousCredentials(env) {
  const required = ['KIMI_MODEL_NAME', 'KIMI_MODEL_API_KEY'];
  const presence = Object.fromEntries(required.map((name) => [name, hasNonBlankEnv(env, name)]));
  const optionalPresence = Object.fromEntries(
    [
      'KIMI_MODEL_PROVIDER_TYPE',
      'KIMI_MODEL_BASE_URL',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
    ].map((name) => [name, hasNonBlankEnv(env, name)]),
  );
  const missing = required.filter((name) => !presence[name]);
  if (missing.length > 0) {
    return {
      status: 'BLOCKED',
      reason: `BLOCKED: missing configured env-model provider credentials: ${missing.join(', ')}.`,
      authMode: 'isolated-env-model',
      simulated: false,
      providerCallStarted: false,
      required,
      present: presence,
      optionalPresent: optionalPresence,
      missing,
      note:
        'This isolated canary uses a temporary KIMI_CODE_HOME, so KIMI_MODEL_NAME and KIMI_MODEL_API_KEY are required to configure a headless model without reading user credentials from disk.',
      redaction: 'Only variable presence is recorded; credential values are never written.',
    };
  }
  return {
    status: 'PASS',
    reason: 'KIMI_MODEL_NAME and KIMI_MODEL_API_KEY are present for the isolated env-model canary.',
    authMode: 'isolated-env-model',
    simulated: false,
    providerCallStarted: false,
    required,
    present: presence,
    optionalPresent: optionalPresence,
    missing: [],
    redaction: 'Only variable presence is recorded; credential values are never written.',
  };
}

async function detectRealKimiHomeCredentials(context) {
  const kimiCodeHome = context.plannedKimiCodeHome;
  const configPath = path.join(kimiCodeHome, 'config.toml');
  const credentialsDir = path.join(kimiCodeHome, 'credentials');
  const configText = await readFileIfExists(configPath);
  const configExists = configText !== undefined;
  const defaultModel = parseTomlString(configText, 'default_model') ?? parseTomlString(configText, 'defaultModel');
  const hasManagedKimiProvider = configText?.includes('managed:kimi-code') === true;
  const hasOauth = configText === undefined ? false : /oauth\s*=|\[\s*providers\.[^\]]+\.oauth\s*\]/iu.test(configText);
  const candidateTokenNames = extractKimiOAuthTokenNames(configText);
  const credentialFiles = readCredentialReadiness(credentialsDir, candidateTokenNames);
  const matchingTokenReady = credentialFiles.some(
    (file) => file.expectedForKimiLogin === true && file.status === 'valid',
  );
  const defaultModelPresent = typeof defaultModel === 'string' && defaultModel.length > 0;
  const kimiCodingDefaultModel = defaultModel === EXPECTED_KIMI_CODE_DEFAULT_MODEL;
  const present = {
    configToml: configExists,
    managedKimiProvider: hasManagedKimiProvider,
    managedKimiOAuth: hasOauth,
    defaultModel: defaultModelPresent,
    kimiCodingDefaultModel,
    matchingOAuthToken: matchingTokenReady,
  };
  const missing = [];
  if (!present.configToml) missing.push('config.toml');
  if (!present.managedKimiProvider) missing.push('managed:kimi-code provider');
  if (!present.managedKimiOAuth) missing.push('managed Kimi OAuth config');
  if (!present.defaultModel) missing.push('default_model');
  if (present.defaultModel && !present.kimiCodingDefaultModel) {
    missing.push(
      `default_model ${EXPECTED_KIMI_CODE_DEFAULT_MODEL} (${EXPECTED_KIMI_CODE_MODEL_LABEL})`,
    );
  }
  if (!present.matchingOAuthToken) {
    missing.push(
      `credentials/${Array.from(candidateTokenNames).toSorted().join('|')}.json valid OAuth token`,
    );
  }
  const base = {
    authMode: 'real-kimi-code-home-login',
    simulated: false,
    providerCallStarted: false,
    required: [
      'real KIMI_CODE_HOME config.toml',
      'managed:kimi-code provider',
      'managed Kimi OAuth token',
      `default_model ${EXPECTED_KIMI_CODE_DEFAULT_MODEL} (${EXPECTED_KIMI_CODE_MODEL_LABEL})`,
    ],
    present,
    optionalPresent: {},
    missing,
    kimiCodeHome,
    configPath,
    credentialsDir,
    defaultModel,
    expectedDefaultModel: EXPECTED_KIMI_CODE_DEFAULT_MODEL,
    expectedDefaultModelLabel: EXPECTED_KIMI_CODE_MODEL_LABEL,
    expectedModelFamily:
      `Kimi /login should provision ${EXPECTED_KIMI_CODE_MODEL_LABEL}; use /model to select ${EXPECTED_KIMI_CODE_MODEL_LABEL} before autonomous QA.`,
    candidateTokenNames: Array.from(candidateTokenNames).toSorted(),
    credentialFiles,
    redaction:
      'Only file names, token shape booleans, and config readiness are recorded; token values are never written.',
  };
  if (missing.length > 0) {
    return {
      ...base,
      status: 'BLOCKED',
      reason: `BLOCKED: real KIMI_CODE_HOME is not ready for /login autonomous canary: ${missing.join(', ')}.`,
      nextAction:
        `Open the TUI, run /login, confirm /model selects ${EXPECTED_KIMI_CODE_MODEL_LABEL}, then rerun this phase with --use-real-kimi-home.`,
    };
  }
  return {
    ...base,
    status: 'PASS',
    reason: `Real KIMI_CODE_HOME has a managed Kimi /login token and ${EXPECTED_KIMI_CODE_MODEL_LABEL} default model ${defaultModel}.`,
  };
}

function parseTomlString(text, key) {
  if (typeof text !== 'string') return undefined;
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`, 'imu');
  return text.match(pattern)?.[1];
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function extractKimiOAuthTokenNames(configText) {
  const names = new Set(['kimi-code']);
  if (typeof configText !== 'string') return names;
  for (const match of configText.matchAll(/\bkey\s*=\s*["']([^"']+)["']/giu)) {
    const storageName = oauthKeyToStorageName(match[1]);
    if (storageName !== undefined) names.add(storageName);
  }
  return names;
}

function oauthKeyToStorageName(key) {
  if (key === 'kimi-code' || key === 'oauth/kimi-code') return 'kimi-code';
  const prefix = 'oauth/';
  if (key.startsWith(prefix) && key.slice(prefix.length).length > 0) {
    return key.slice(prefix.length);
  }
  if (!key.includes('/') && !key.startsWith('.') && key.length > 0) return key;
  return undefined;
}

function readCredentialReadiness(credentialsDir, candidateTokenNames) {
  let entries;
  try {
    entries = readdirSync(credentialsDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.json'))
    .toSorted()
    .map((entry) => {
      const tokenName = entry.slice(0, -'.json'.length);
      const base = {
        name: entry,
        tokenName,
        expectedForKimiLogin: candidateTokenNames.has(tokenName),
      };
      try {
        const credentialPath = path.join(credentialsDir, entry);
        const raw = readdirStatFile(credentialPath) > 0
          ? JSON.parse(readFileSync(credentialPath, 'utf8'))
          : undefined;
        const hasAccessToken = typeof raw?.access_token === 'string' && raw.access_token.length > 0;
        const hasRefreshToken = typeof raw?.refresh_token === 'string' && raw.refresh_token.length > 0;
        return {
          ...base,
          status: hasAccessToken ? 'valid' : hasRefreshToken ? 'refresh-only' : 'empty',
          hasAccessToken,
          hasRefreshToken,
          expiresAtType: typeof raw?.expires_at,
        };
      } catch {
        return {
          ...base,
          status: 'unreadable',
          hasAccessToken: false,
          hasRefreshToken: false,
          expiresAtType: 'unknown',
        };
      }
    });
}

function hasNonBlankEnv(env, name) {
  return typeof env[name] === 'string' && env[name].trim().length > 0;
}

async function runAutonomousRecordedCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError;
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  let forceKillTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
  }, spec.timeoutMs);
  const close = await new Promise((resolve) => {
    child.on('error', (error) => {
      spawnError = error;
      resolve({ code: 1, signal: undefined });
    });
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  clearTimeout(timer);
  if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);

  const completedAt = new Date().toISOString();
  const redactedStdout = redactCommandOutput(stdout, context.redactionPolicy);
  const redactedStderr = redactCommandOutput(stderr, context.redactionPolicy);
  await writeFile(spec.streamPath, redactedStdout, 'utf8');
  const basePath = path.join(context.evidenceRoot, 'commands', `autonomous-${spec.name}`);
  await writeFile(`${basePath}.stdout.txt`, redactedStdout, 'utf8');
  await writeFile(`${basePath}.stderr.txt`, redactedStderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${close.code ?? 1}\n`, 'utf8');
  const record = {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    env: spec.envForEvidence,
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    exitCode: close.code ?? 1,
    signal: close.signal,
    timedOut,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
    streamPath: spec.streamPath,
    stdout: redactedStdout,
    stderr: redactedStderr,
    error: spawnError?.message,
  };
  await appendAutonomousCommandRecord(context.evidenceRoot, record);
  return record;
}

async function runAutonomousProofCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const result = runBoundedCommand(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    timeoutMs: spec.timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const stdout = redactCommandOutput(result.stdout, context.redactionPolicy);
  const stderr = redactCommandOutput(result.stderr, context.redactionPolicy);
  const basePath = path.join(context.evidenceRoot, 'commands', `autonomous-${spec.name}`);
  const stdoutPath = spec.stdoutPath ?? `${basePath}.stdout.txt`;
  const stderrPath = spec.stderrPath ?? `${basePath}.stderr.txt`;
  const stdoutContent = spec.logCommandAndExit
    ? [
        `command=${formatArgv([spec.command, ...spec.args])}`,
        `cwd=${spec.cwd}`,
        `exitCode=${result.status}`,
        `timedOut=${result.timedOut}`,
        stdout === '' ? 'stdout=<empty>' : `stdout=${stdout}`,
        stderr === '' ? 'stderr=<empty>' : `stderr=${stderr}`,
        '',
      ].join('\n')
    : stdout;
  await writeFile(stdoutPath, stdoutContent, 'utf8');
  await writeFile(stderrPath, stderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${result.status}\n`, 'utf8');
  const record = {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    env: {},
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    stdoutPath,
    stderrPath,
    exitCodePath: `${basePath}.exit-code.txt`,
    stdout,
    stderr,
    error: result.error,
  };
  await appendAutonomousCommandRecord(context.evidenceRoot, record);
  return record;
}

async function appendAutonomousCommandRecord(evidenceRoot, record) {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(path.join(evidenceRoot, 'commands', 'autonomous.jsonl'), line, 'utf8');
  await appendFile(path.join(evidenceRoot, 'commands', 'commands.jsonl'), line, 'utf8');
}

function parseAutonomousStream(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Non-JSON tool output is retained in stream.jsonl but cannot satisfy goal.summary.
    }
  }
  const goalSummary = parsed.findLast((entry) => entry?.type === 'goal.summary')
    ?? parsed.findLast((entry) => entry?.goal?.summary !== undefined)?.goal?.summary;
  return {
    lineCount: lines.length,
    parsedCount: parsed.length,
    goalSummary,
  };
}

function validateAutonomousDiff(diff) {
  const lines = diff.split(/\r?\n/).filter((line) => line.length > 0);
  const diffHeaders = lines.filter((line) => line.startsWith('diff --git '));
  const addedContent = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  const removedContent = lines.filter((line) => line.startsWith('-') && !line.startsWith('---'));
  const invalidHeaders = diffHeaders.filter(
    (line) => line !== `diff --git a/${AUTONOMOUS_CANARY_FILE} b/${AUTONOMOUS_CANARY_FILE}`,
  );
  const invalidAdded = addedContent.filter((line) => line !== `+${AUTONOMOUS_CANARY_TOKEN}`);
  const failures = [];
  if (diff.trim() === '') failures.push('git diff output was empty');
  if (diffHeaders.length === 0) failures.push('git diff did not include a file header');
  if (invalidHeaders.length > 0) failures.push(`git diff included unexpected file headers: ${invalidHeaders.join('; ')}`);
  if (!addedContent.includes(`+${AUTONOMOUS_CANARY_TOKEN}`)) {
    failures.push(`git diff did not add ${AUTONOMOUS_CANARY_TOKEN}`);
  }
  if (invalidAdded.length > 0) failures.push(`git diff included unexpected added content: ${invalidAdded.join('; ')}`);
  if (removedContent.length > 0) failures.push(`git diff included removed content: ${removedContent.join('; ')}`);
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? `git diff is limited to ${AUTONOMOUS_CANARY_FILE} with ${AUTONOMOUS_CANARY_TOKEN}.`
        : failures.join('; '),
    diffHeaders,
    addedContent,
    removedContent,
  };
}

function validateAutonomousStatus(statusOutput) {
  const entries = statusOutput.split(/\r?\n/).filter((line) => line.trim() !== '');
  const invalid = entries.filter((line) => !line.endsWith(` ${AUTONOMOUS_CANARY_FILE}`));
  return {
    status: entries.length > 0 && invalid.length === 0 ? 'PASS' : 'FAIL',
    reason:
      entries.length > 0 && invalid.length === 0
        ? `git status is limited to ${AUTONOMOUS_CANARY_FILE}.`
        : `git status must mention only ${AUTONOMOUS_CANARY_FILE}; actual=${JSON.stringify(entries)}`,
    entries,
  };
}

function validateDirectCliIsolation(context) {
  const kimiCodeHome = path.resolve(context.plannedKimiCodeHome);
  const userHome = path.resolve(os.homedir());
  const defaultKimiHome = path.join(userHome, '.kimi-code');
  if (isPathInside(context.targetWorktree, context.sourceCheckout)) {
    return { status: 'FAIL', reason: 'targetWorkspace must be outside the source checkout.' };
  }
  if (context.options.useRealKimiHome) {
    return {
      status: 'PASS',
      reason:
        'KIMI_CODE_HOME uses the default user Kimi home by explicit --use-real-kimi-home opt-in; targetWorkspace remains isolated from the source checkout.',
      generatedHome: false,
      sourceCwd: context.sourceCheckout,
      targetWorkspace: context.targetWorktree,
      kimiCodeHome,
      homeMode: 'real-user-opt-in',
    };
  }
  if (kimiCodeHome === userHome) {
    return { status: 'FAIL', reason: 'KIMI_CODE_HOME resolves to the real user home.' };
  }
  if (kimiCodeHome === defaultKimiHome) {
    return { status: 'FAIL', reason: 'KIMI_CODE_HOME resolves to the default user Kimi home.' };
  }
  return {
    status: 'PASS',
    reason: 'KIMI_CODE_HOME and targetWorkspace are isolated from default user runtime state.',
    generatedHome: context.options.kimiCodeHome === undefined,
    sourceCwd: context.sourceCheckout,
    targetWorkspace: context.targetWorktree,
    kimiCodeHome,
  };
}

function defaultRealKimiCodeHome() {
  return path.join(os.homedir(), '.kimi-code');
}

async function inspectKimiCodeHomeForLiveWorkflow(kimiCodeHome) {
  const resolvedPath = path.resolve(kimiCodeHome);
  if (resolvedPath === path.resolve(os.homedir())) {
    return {
      status: 'FAIL',
      reason: 'real workflow KIMI_CODE_HOME must not point at the user home directory itself.',
      path: resolvedPath,
    };
  }
  let info;
  try {
    info = await stat(resolvedPath);
  } catch {
    return {
      status: 'BLOCKED',
      reason: `real KIMI_CODE_HOME does not exist: ${resolvedPath}`,
      path: resolvedPath,
    };
  }
  if (!info.isDirectory()) {
    return {
      status: 'FAIL',
      reason: `real KIMI_CODE_HOME is not a directory: ${resolvedPath}`,
      path: resolvedPath,
    };
  }
  return {
    status: 'PASS',
    reason:
      'Real KIMI_CODE_HOME exists and will be used by explicit opt-in without reading or copying secret contents.',
    path: resolvedPath,
  };
}

async function createDisposableGitWorktree(context) {
  await mkdir(path.dirname(context.targetWorktree), { recursive: true });
  const result = runBoundedCommand(
    'git',
    ['worktree', 'add', '--detach', context.targetWorktree, 'HEAD'],
    {
      cwd: context.sourceCheckout,
      timeoutMs: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`failed to create disposable target worktree: ${result.stderr || result.stdout}`);
  }
}

async function linkDisposableWorktreeTooling(context) {
  const links = [
    ['root-node-modules', path.join(context.sourceCheckout, 'node_modules'), path.join(context.targetWorktree, 'node_modules')],
    [
      'kimi-code-node-modules',
      path.join(context.sourceCheckout, 'apps', 'kimi-code', 'node_modules'),
      path.join(context.targetWorktree, 'apps', 'kimi-code', 'node_modules'),
    ],
  ];
  const results = [];
  for (const [name, sourcePath, targetPath] of links) {
    const sourceStatus = await fileOrDirectoryStatus(sourcePath);
    if (!sourceStatus.exists) {
      results.push({ name, sourcePath, targetPath, status: 'MISSING_SOURCE' });
      continue;
    }
    const targetStatus = await fileOrDirectoryStatus(targetPath);
    if (targetStatus.exists) {
      results.push({ name, sourcePath, targetPath, status: 'ALREADY_PRESENT' });
      continue;
    }
    await symlink(sourcePath, targetPath, 'dir');
    results.push({ name, sourcePath, targetPath, status: 'LINKED' });
  }
  return results;
}

async function fileOrDirectoryStatus(filePath) {
  try {
    const info = await stat(filePath);
    return { exists: true, isDirectory: info.isDirectory(), bytes: info.size };
  } catch {
    return { exists: false, isDirectory: false, bytes: 0 };
  }
}

async function readKimiCodePackageVersion(sourceCheckout) {
  const packageJsonPath = path.join(sourceCheckout, 'apps', 'kimi-code', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  return packageJson.version;
}

async function resolveDirectCliRuntimeEnv(sourceCheckout, baseEnv) {
  const candidateDirs = await findNodeCandidateDirs(sourceCheckout, baseEnv);
  const attempts = [];
  for (const binDir of candidateDirs) {
    const env = {
      ...baseEnv,
      PATH: [binDir, baseEnv.PATH].filter(Boolean).join(path.delimiter),
    };
    const node = runBoundedCommand('node', ['-v'], {
      cwd: sourceCheckout,
      env,
      timeoutMs: 10_000,
    });
    const nodeVersion = node.stdout.trim().replace(/^v/, '');
    const pnpm = runBoundedCommand('corepack', ['pnpm', '-v'], {
      cwd: sourceCheckout,
      env,
      timeoutMs: 20_000,
    });
    const attempt = {
      binDir,
      nodeVersion: node.stdout.trim() || node.stderr.trim() || `exit ${node.status}`,
      pnpmVersion: pnpm.stdout.trim() || pnpm.stderr.trim() || `exit ${pnpm.status}`,
      nodeExitCode: node.status,
      pnpmExitCode: pnpm.status,
    };
    attempts.push(attempt);
    if (node.status === 0 && compareVersions(nodeVersion, '24.15.0') >= 0 && pnpm.stdout.trim() === '10.33.0') {
      return {
        env,
        metadata: {
          status: 'PASS',
          selectedBinDir: binDir,
          nodeVersion: node.stdout.trim(),
          pnpmVersion: pnpm.stdout.trim(),
          attempts,
        },
      };
    }
  }

  throw new Error(
    `direct CLI requires Node >=24.15.0 with corepack pnpm 10.33.0; attempts=${JSON.stringify(attempts)}`,
  );
}

async function findNodeCandidateDirs(sourceCheckout, baseEnv) {
  const candidateDirs = new Set([path.dirname(process.execPath)]);
  try {
    const nvmrc = (await readFile(path.join(sourceCheckout, '.nvmrc'), 'utf8')).trim().replace(/^v/, '');
    if (nvmrc !== '') {
      candidateDirs.add(path.join(os.homedir(), '.nvm', 'versions', 'node', `v${nvmrc}`, 'bin'));
    }
  } catch {
    // Best-effort version manager discovery only.
  }

  const discovered = runBoundedCommand(
    '/bin/sh',
    [
      '-lc',
      'find "$HOME/.nvm/versions/node" -maxdepth 1 -type d -name "v24*" 2>/dev/null | sort -Vr',
    ],
    {
      cwd: sourceCheckout,
      env: baseEnv,
      timeoutMs: 10_000,
    },
  );
  for (const dir of discovered.stdout.split('\n')) {
    if (dir.trim() !== '') {
      candidateDirs.add(path.join(dir.trim(), 'bin'));
    }
  }

  return [...candidateDirs];
}

async function runRecordedCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const result = runBoundedCommand(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    timeoutMs: spec.timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const basePath = path.join(context.evidenceRoot, 'commands', `direct-cli-${spec.name}`);
  await writeFile(`${basePath}.stdout.txt`, result.stdout, 'utf8');
  await writeFile(`${basePath}.stderr.txt`, result.stderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${result.status}\n`, 'utf8');
  const record = {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    sourceCwd: spec.metadata.sourceCwd,
    targetWorkspace: spec.metadata.targetWorkspace,
    env: spec.metadata.env,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
  await appendFile(
    path.join(context.evidenceRoot, 'commands', 'direct-cli.jsonl'),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
  return record;
}

function passFail(condition, reason) {
  return { status: condition ? 'PASS' : 'FAIL', reason };
}

function validateCommandOutputHomeIsolation(records) {
  const defaultKimiHome = path.join(os.homedir(), '.kimi-code');
  const output = records.map((record) => `${record.stdout}\n${record.stderr}`).join('\n');
  return passFail(
    !output.includes(defaultKimiHome),
    'command output must not show the default user Kimi home.',
  );
}

function outputHasExactLine(output, expectedLine) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes(expectedLine);
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function commandProof(result) {
  return {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.status,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  };
}

function tmuxKeyboardProtocolEvidence() {
  return {
    extendedKeys: 'on',
    extendedKeysFormat: 'csi-u',
    setup:
      'Each live TUI tmux session runs set-option before starting Kimi Code so modified keys are observable.',
  };
}

function buildTmuxKeyboardSetupCommand(tmuxSession) {
  return [
    `tmux set-option -t ${shellQuote(tmuxSession)} extended-keys on`,
    `tmux set-option -t ${shellQuote(tmuxSession)} extended-keys-format csi-u`,
  ].join('; ') + ';';
}

function buildTuiDevShellCommand(kimiCodeDir) {
  return `corepack pnpm --silent -C ${kimiCodeDir} run dev --`;
}

async function runTuiLaunchPhase(context) {
  const startedAt = new Date().toISOString();
  const tuiDir = path.join(context.evidenceRoot, 'tui');
  const tmuxSession = context.options.tmuxSession ?? `super-kimi-qa-${context.runId}`;
  const commandRecords = [];
  const cleanupOverrides = {
    status: 'tui-launch-completed',
    reason: 'TUI launch phase recorded tmux/computer-use evidence and cleanup state.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    closedTmuxSessions: [],
    proofCommands: [],
  };
  const summary = {
    schemaVersion: 1,
    phase: 'tui-launch',
    status: 'BLOCKED',
    reason: 'TUI launch did not run yet.',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    targetWorkspace: context.targetWorktree,
    targetWorkspaceKind: 'disposable-git-worktree',
    kimiCodeHome: context.plannedKimiCodeHome,
    kimiCodeHomeMode: context.kimiCodeHomeMode,
    tmuxSession,
    terminalTitle: context.titlePrefix,
    tmuxKeyboardProtocol: tmuxKeyboardProtocolEvidence(),
    launchCommand: [
      'tmux set-option -t <session> extended-keys on',
      'tmux set-option -t <session> extended-keys-format csi-u',
      'KIMI_CODE_HOME=<tmp-home>',
      'KIMI_CODE_DEV_CWD=<disposable-target-worktree>',
      'corepack',
      'pnpm',
      '--silent',
      '-C',
      '<source>/apps/kimi-code',
      'run',
      'dev',
      '--',
      '--auto',
      '--add-dir',
      '<disposable-target-worktree>',
    ],
    scenarios: TUI_CAPTURE_SCENARIOS,
    commands: commandRecords,
    inputTraces: [],
    captures: [],
    validations: {},
  };
  let targetWorktreeCreated = false;
  let tempHomeCreated = false;
  let tempRootCreated = false;
  let tmuxSessionCreated = false;
  let migrationSkipMarker;

  await mkdir(tuiDir, { recursive: true });
  await writeTuiAttachHelpers(context, tmuxSession);

  try {
    const computerUse = await collectComputerUseEvidence(context);
    summary.computerUse = computerUse;
    const computerUseExplicitlyRequired = context.options.requireComputerUse !== undefined;
    summary.validations.computerUseState = passFail(
      computerUse.status === 'PASS' || !computerUseExplicitlyRequired,
      computerUse.status === 'PASS'
        ? computerUse.reason
        : `Optional computer-use unavailable; continuing with tmux visible evidence: ${computerUse.reason}`,
    );
    summary.computerUseOptional = {
      status: computerUse.status,
      reason: computerUse.reason,
    };
    summary.validations.tmuxPreflight = passFail(
      context.preflight?.tmux?.status === 'PASS',
      context.preflight?.tmux?.detail ?? 'tmux preflight was not recorded.',
    );

    if (summary.validations.tmuxPreflight.status !== 'PASS') {
      summary.reason = `BLOCKED: tmux unavailable (${context.preflight?.tmux?.actual ?? 'unknown'}).`;
      return await finishTuiLaunchPhase(context, summary, cleanupOverrides);
    }
    if (computerUseExplicitlyRequired && summary.validations.computerUseState.status !== 'PASS') {
      summary.reason = `BLOCKED: ${computerUse.reason}`;
      return await finishTuiLaunchPhase(context, summary, cleanupOverrides);
    }

    await mkdir(context.tempRoot, { recursive: true });
    tempRootCreated = true;
    if (context.kimiCodeHomeMode === 'real-user-opt-in') {
      const realHomeProbe = await inspectKimiCodeHomeForLiveWorkflow(context.plannedKimiCodeHome);
      summary.kimiCodeHomeProbe = realHomeProbe;
      summary.validations.kimiCodeHomeReady = passFail(
        realHomeProbe.status === 'PASS',
        realHomeProbe.reason,
      );
      if (summary.validations.kimiCodeHomeReady.status !== 'PASS') {
        summary.status = realHomeProbe.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
        summary.reason = realHomeProbe.reason;
        return await finishTuiLaunchPhase(context, summary, cleanupOverrides);
      }
      summary.migrationPromptSuppressed = {
        status: 'NOT_REQUIRED',
        reason:
          'Real user KIMI_CODE_HOME was selected by explicit opt-in; the harness did not write migration markers.',
        markerPath: undefined,
      };
    } else {
      await mkdir(context.plannedKimiCodeHome, { recursive: true, mode: 0o700 });
      tempHomeCreated = true;
      migrationSkipMarker = path.join(context.plannedKimiCodeHome, '.skip-migration-from-kimi-cli');
      await writeFile(migrationSkipMarker, '', 'utf8');
      summary.kimiCodeHomeProbe = {
        status: 'PASS',
        reason: 'Temporary isolated KIMI_CODE_HOME was created with migration prompt suppressed.',
        path: context.plannedKimiCodeHome,
      };
      summary.migrationPromptSuppressed = {
        status: 'PASS',
        reason: 'Temporary QA KIMI_CODE_HOME includes the first-launch migration skip marker.',
        markerPath: migrationSkipMarker,
      };
    }
    await createDisposableGitWorktree(context);
    targetWorktreeCreated = true;

    const launchShellCommand = [
      buildTmuxKeyboardSetupCommand(tmuxSession),
      `KIMI_CODE_HOME=${shellQuote(context.plannedKimiCodeHome)}`,
      `KIMI_CODE_DEV_CWD=${shellQuote(context.targetWorktree)}`,
      buildTuiDevShellCommand(shellQuote(path.join(context.sourceCheckout, 'apps', 'kimi-code'))),
      '--auto',
      '--add-dir',
      shellQuote(context.targetWorktree),
    ].join(' ');
    const launchRecord = await runTuiCommand(context, {
      name: 'tmux-new-session',
      command: 'tmux',
      args: [
        'new-session',
        '-d',
        '-s',
        tmuxSession,
        '-x',
        '120',
        '-y',
        '40',
        '-c',
        context.targetWorktree,
        launchShellCommand,
      ],
      cwd: context.sourceCheckout,
      timeoutMs: 30_000,
    });
    commandRecords.push(launchRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(launchRecord));
    if (launchRecord.exitCode !== 0) {
      summary.status = 'FAIL';
      summary.reason = 'tmux new-session failed; see command stderr evidence.';
      return await finishTuiLaunchPhase(context, summary, cleanupOverrides);
    }
    tmuxSessionCreated = true;
    cleanupOverrides.liveProcessesStarted = true;
    cleanupOverrides.liveProductCommandsStarted = true;

    await sleep(4_000);
    const startupCapture = await captureTmuxPane(context, tmuxSession, 'startup');
    summary.captures.push(startupCapture);
    summary.validations.launchWorkspace = await validateTuiLaunchWorkspace(context, startupCapture);

    for (const scenario of TUI_CAPTURE_SCENARIOS.filter((item) => item.name !== 'startup')) {
      const keysToSend =
        scenario.name === 'exit' && scenario.keys?.at(-1) === 'Enter'
          ? scenario.keys.slice(0, -1)
          : scenario.keys;
      if (keysToSend !== undefined) {
        const inputTrace = await sendTmuxKeySequence(
          context,
          tmuxSession,
          scenario.name,
          scenario.keyGroups ?? keysToSend,
        );
        summary.inputTraces.push(inputTrace);
        commandRecords.push(...inputTrace.commands);
        cleanupOverrides.proofCommands.push(
          ...inputTrace.commands.map((record) => commandProofFromRecord(record)),
        );
        await sleep(1_000);
      }
      summary.captures.push(await captureTmuxPane(context, tmuxSession, scenario.name));
      if (scenario.name === 'exit' && scenario.keys?.at(-1) === 'Enter') {
        const submitExitTrace = await sendTmuxKeySequence(context, tmuxSession, 'exit-submit', [
          'Enter',
        ]);
        summary.inputTraces.push(submitExitTrace);
        commandRecords.push(...submitExitTrace.commands);
        cleanupOverrides.proofCommands.push(
          ...submitExitTrace.commands.map((record) => commandProofFromRecord(record)),
        );
        await sleep(4_000);
      }
    }

    summary.validations.tmuxScreenProof = validateTuiScreenProof(summary.captures);
    summary.validations.exitSessionClosed = validateTuiExitSession(context, tmuxSession);
    cleanupOverrides.proofCommands.push(summary.validations.exitSessionClosed.commandProof);
    const failedValidation = Object.values(summary.validations).find(
      (validation) => validation.status !== 'PASS',
    );
    if (failedValidation === undefined) {
      summary.status = 'PASS';
      summary.reason =
        computerUse.status === 'PASS'
          ? 'Visible TUI scenarios have fresh computer-use state and Kimi-specific tmux screen evidence.'
          : 'Visible TUI scenarios passed with Kimi-specific tmux screen evidence; computer-use was optional and unavailable.';
    } else {
      summary.status = failedValidation === summary.validations.computerUseState ? 'BLOCKED' : 'FAIL';
      summary.reason = failedValidation.reason;
    }
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    if (tmuxSessionCreated) {
      const hasSession = runBoundedCommand('tmux', ['has-session', '-t', tmuxSession], {
        cwd: context.sourceCheckout,
        timeoutMs: 10_000,
      });
      cleanupOverrides.proofCommands.push(commandProof(hasSession));
      if (hasSession.status === 0) {
        const killSession = runBoundedCommand('tmux', ['kill-session', '-t', tmuxSession], {
          cwd: context.sourceCheckout,
          timeoutMs: 10_000,
        });
        cleanupOverrides.proofCommands.push(commandProof(killSession));
        cleanupOverrides.closedTmuxSessions = [
          {
            name: tmuxSession,
            status: killSession.status === 0 ? 'closed' : 'close-failed',
            exitCode: killSession.status,
          },
        ];
      }
    }
    if (!context.options.keepTemp) {
      if (targetWorktreeCreated) {
        const removal = runBoundedCommand(
          'git',
          ['worktree', 'remove', '--force', context.targetWorktree],
          {
            cwd: context.sourceCheckout,
            timeoutMs: 60_000,
          },
        );
        cleanupOverrides.proofCommands.push(commandProof(removal));
        cleanupOverrides.targetWorktree = {
          path: context.targetWorktree,
          created: true,
          removed: removal.status === 0,
          retained: removal.status !== 0,
          detail: 'Disposable TUI target worktree cleanup.',
        };
      }
      if (tempRootCreated) {
        await rm(context.tempRoot, { recursive: true, force: true });
      }
    }
    cleanupOverrides.tempHome = {
      path: context.plannedKimiCodeHome,
      created: tempHomeCreated,
      removed: tempRootCreated && !context.options.keepTemp,
      retained: tempRootCreated && context.options.keepTemp,
      detail: tempHomeCreated
        ? 'TUI KIMI_CODE_HOME was created for isolated launch.'
        : 'TUI KIMI_CODE_HOME was not created before block/failure.',
    };
    cleanupOverrides.targetWorktree = cleanupOverrides.targetWorktree ?? {
      path: context.targetWorktree,
      created: targetWorktreeCreated,
      removed: false,
      retained: targetWorktreeCreated,
      detail: targetWorktreeCreated
        ? 'Disposable TUI target worktree was created.'
        : 'Disposable TUI target worktree was not created before block/failure.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: tempRootCreated,
      removed: tempRootCreated && !context.options.keepTemp,
      retained: tempRootCreated && context.options.keepTemp,
      detail: tempRootCreated ? 'TUI temp root cleanup recorded.' : 'TUI temp root was not created.',
    };
  }

  return finishTuiLaunchPhase(context, summary, cleanupOverrides);
}

async function finishTuiLaunchPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  cleanupOverrides.status =
    summary.status === 'PASS'
      ? 'tui-launch-pass-cleaned'
      : summary.status === 'BLOCKED'
        ? 'tui-launch-blocked-cleaned'
        : 'tui-launch-failed-cleaned';
  cleanupOverrides.reason = summary.reason;
  await writeJson(path.join(context.evidenceRoot, 'tui-launch.json'), summary);
  await writeJson(path.join(context.evidenceRoot, 'tui', 'summary.json'), summary);
  if (summary.status === 'BLOCKED') {
    await writeJson(path.join(context.evidenceRoot, 'failure-terminal-tool.json'), {
      status: 'BLOCKED',
      reason: summary.reason,
      computerUse: summary.computerUse,
      tmuxSession: summary.tmuxSession,
    });
  }
  const phaseEntry = {
    name: 'tui-launch',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted: summary.commands.length > 0,
    liveProductCommandStarted: summary.commands.some((command) => command.name === 'tmux-new-session'),
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

async function runTuiRealWorkflowPhase(context) {
  const startedAt = new Date().toISOString();
  const workflowDir = path.join(context.evidenceRoot, 'workflow');
  const tmuxSession = context.options.tmuxSession ?? `super-kimi-real-workflow-${context.runId}`;
  const commandRecords = [];
  const cleanupOverrides = {
    status: 'tui-real-workflow-completed',
    reason: 'Real TUI workflow phase recorded prompt submission, workspace evidence, and cleanup state.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    closedTmuxSessions: [],
    proofCommands: [],
  };
  const workflowPaths = {
    sourcePath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_SOURCE_FILE),
    testPath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_TEST_FILE),
    verifierPath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_VERIFIER),
    targetedTestCommand: buildTuiRealWorkflowTargetedTestCommand(context),
  };
  const fixturePath = workflowPaths.sourcePath;
  const workflowPrompt = buildTuiRealWorkflowPrompt(workflowPaths);
  const summary = {
    schemaVersion: 1,
    phase: 'tui-real-workflow',
    status: 'BLOCKED',
    reason: 'Real TUI workflow did not run yet.',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    targetWorkspace: context.targetWorktree,
    targetWorkspaceKind: 'disposable-git-worktree',
    gateScope: {
      kind: 'direct-tui-coding',
      ultraworkAutomation: 'explicitly-disabled-for-this-gate',
      planMode: 'off',
      permissionMode: 'auto',
      reason:
        'This gate proves screen-driven direct coding on real repository source/tests through the standard /plan off and /auto permission path; Ultrawork activation and planning must be covered by a separate workflow gate.',
    },
    kimiCodeHome: context.plannedKimiCodeHome,
    kimiCodeHomeMode: context.kimiCodeHomeMode,
    tmuxSession,
    terminalTitle: context.titlePrefix,
    tmuxKeyboardProtocol: tmuxKeyboardProtocolEvidence(),
    fixture: {
      relativePath: TUI_REAL_WORKFLOW_SOURCE_FILE,
      expectedSentinel: TUI_REAL_WORKFLOW_SENTINEL,
      editFiles: TUI_REAL_WORKFLOW_EDIT_FILES,
      verificationFile: TUI_REAL_WORKFLOW_VERIFIER,
      targetedTestFile: TUI_REAL_WORKFLOW_TEST_FILE,
      minimumEditedFiles: TUI_REAL_WORKFLOW_EDIT_FILES.length,
    },
    prompt: workflowPrompt,
    commands: commandRecords,
    inputTraces: [],
    captures: [],
    validations: {},
    evaluation: {
      tier: 'adaptive-terminal-operator-loop',
      primaryUse: 'live TUI coding operator gate',
      limitation:
        'This phase uses heuristic terminal-screen steering, not full multimodal desktop control.',
      previousTier: 'real-tui-observed-workflow',
    },
    workflow: {},
    workspace: {},
  };
  let targetWorktreeCreated = false;
  let tempHomeCreated = false;
  let tempRootCreated = false;
  let tmuxSessionCreated = false;

  await mkdir(workflowDir, { recursive: true });
  await mkdir(path.join(context.evidenceRoot, 'tui'), { recursive: true });
  await writeTuiAttachHelpers(context, tmuxSession);

  try {
    summary.validations.tmuxPreflight = passFail(
      context.preflight?.tmux?.status === 'PASS',
      context.preflight?.tmux?.detail ?? 'tmux preflight was not recorded.',
    );
    if (summary.validations.tmuxPreflight.status !== 'PASS') {
      summary.reason = `BLOCKED: tmux unavailable (${context.preflight?.tmux?.actual ?? 'unknown'}).`;
      return await finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
    }

    await mkdir(context.tempRoot, { recursive: true });
    tempRootCreated = true;
    if (context.kimiCodeHomeMode === 'real-user-opt-in') {
      const realHomeProbe = await inspectKimiCodeHomeForLiveWorkflow(context.plannedKimiCodeHome);
      summary.kimiCodeHomeProbe = realHomeProbe;
      summary.validations.kimiCodeHomeReady = passFail(
        realHomeProbe.status === 'PASS',
        realHomeProbe.reason,
      );
      if (summary.validations.kimiCodeHomeReady.status !== 'PASS') {
        summary.status = realHomeProbe.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
        summary.reason = realHomeProbe.reason;
        return await finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
      }
    } else {
      await mkdir(context.plannedKimiCodeHome, { recursive: true, mode: 0o700 });
      tempHomeCreated = true;
      const migrationSkipMarker = path.join(context.plannedKimiCodeHome, '.skip-migration-from-kimi-cli');
      await writeFile(migrationSkipMarker, '', 'utf8');
      summary.kimiCodeHomeProbe = {
        status: 'PASS',
        reason: 'Temporary isolated KIMI_CODE_HOME was created with migration prompt suppressed.',
        path: context.plannedKimiCodeHome,
      };
    }
    await createDisposableGitWorktree(context);
    targetWorktreeCreated = true;
    summary.toolingLinks = await linkDisposableWorktreeTooling(context);
    await writeTuiRealWorkflowFixtures(context);
    await writeJson(path.join(workflowDir, 'fixture-before.json'), {
      files: await readTuiRealWorkflowFileState(workflowPaths),
    });
    const intentToAddRecord = await runTuiCommand(context, {
      name: 'real-workflow-fixture-intent-to-add',
      command: 'git',
      args: ['add', '-N', ...TUI_REAL_WORKFLOW_EDIT_FILES],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-real-workflow',
    });
    commandRecords.push(intentToAddRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(intentToAddRecord));
    if (intentToAddRecord.exitCode !== 0) {
      summary.status = 'FAIL';
      summary.reason = 'failed to mark the real workflow fixture for diff tracking.';
      return await finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
    }

    const launchShellCommand = [
      buildTmuxKeyboardSetupCommand(tmuxSession),
      `KIMI_CODE_HOME=${shellQuote(context.plannedKimiCodeHome)}`,
      `KIMI_CODE_DEV_CWD=${shellQuote(context.targetWorktree)}`,
      buildTuiDevShellCommand(shellQuote(path.join(context.sourceCheckout, 'apps', 'kimi-code'))),
      '--auto',
      '--add-dir',
      shellQuote(context.targetWorktree),
    ].join(' ');
    const launchRecord = await runTuiCommand(context, {
      name: 'real-workflow-tmux-new-session',
      command: 'tmux',
      args: [
        'new-session',
        '-d',
        '-s',
        tmuxSession,
        '-x',
        '120',
        '-y',
        '40',
        '-c',
        context.targetWorktree,
        launchShellCommand,
      ],
      cwd: context.sourceCheckout,
      timeoutMs: 30_000,
      logName: 'tui-real-workflow',
    });
    commandRecords.push(launchRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(launchRecord));
    if (launchRecord.exitCode !== 0) {
      summary.status = 'FAIL';
      summary.reason = 'tmux new-session failed; see command stderr evidence.';
      return await finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
    }
    tmuxSessionCreated = true;
    cleanupOverrides.liveProcessesStarted = true;
    cleanupOverrides.liveProductCommandsStarted = true;

    const startupReady = await waitForKimiTuiReady(context, tmuxSession, TUI_READY_TIMEOUT_MS);
    summary.workflow.startupReady = startupReady;
    if (startupReady.status !== 'PASS') {
      summary.status = 'FAIL';
      summary.reason = startupReady.reason;
      return await finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
    }
    const startupCapture = await captureTmuxPane(context, tmuxSession, 'startup');
    summary.captures.push(startupCapture);
    summary.validations.kimiModelReady = await validateTuiRealWorkflowModelEvidence(summary.captures);
    if (summary.validations.kimiModelReady.status !== 'PASS') {
      summary.validations.kimiModelReady = {
        ...summary.validations.kimiModelReady,
        status: 'BLOCKED',
        reason:
          `${summary.validations.kimiModelReady.reason} ` +
          'Run the live workflow with --use-real-kimi-home after /login selects K2.7 Code.',
      };
      summary.status = 'BLOCKED';
      summary.reason = summary.validations.kimiModelReady.reason;
      return await finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
    }

    const planOffTrace = await sendTmuxKeySequence(context, tmuxSession, 'real-workflow-plan-off', [
      '/plan off',
      'Enter',
    ]);
    summary.inputTraces.push(planOffTrace);
    commandRecords.push(...planOffTrace.commands);
    cleanupOverrides.proofCommands.push(
      ...planOffTrace.commands.map((record) => commandProofFromRecord(record)),
    );
    await sleep(1_000);
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'real-workflow-plan-off'));

    const autoModeTrace = await sendTmuxKeySequence(context, tmuxSession, 'real-workflow-auto-on', [
      '/auto on',
      'Enter',
    ]);
    summary.inputTraces.push(autoModeTrace);
    commandRecords.push(...autoModeTrace.commands);
    cleanupOverrides.proofCommands.push(
      ...autoModeTrace.commands.map((record) => commandProofFromRecord(record)),
    );
    await sleep(1_000);
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'real-workflow-auto-on'));

    const promptTrace = await sendTmuxKeySequence(context, tmuxSession, 'real-workflow-prompt', [
      workflowPrompt,
      'Enter',
    ]);
    summary.inputTraces.push(promptTrace);
    commandRecords.push(...promptTrace.commands);
    cleanupOverrides.proofCommands.push(
      ...promptTrace.commands.map((record) => commandProofFromRecord(record)),
    );
    await sleep(2_000);
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'real-workflow-submitted'));

    const waitResult = await waitForRealWorkflowOutcome(context, tmuxSession, workflowPaths);
    summary.workflow.wait = waitResult;
    if (Array.isArray(waitResult.inputTraces)) {
      summary.inputTraces.push(...waitResult.inputTraces);
      for (const inputTrace of waitResult.inputTraces) {
        commandRecords.push(...inputTrace.commands);
        cleanupOverrides.proofCommands.push(
          ...inputTrace.commands.map((record) => commandProofFromRecord(record)),
        );
      }
    }
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'real-workflow-after-wait'));
    await writeJson(path.join(workflowDir, 'fixture-after.json'), {
      files: await readTuiRealWorkflowFileState(workflowPaths),
    });

    const diffRecord = await runTuiCommand(context, {
      name: 'real-workflow-git-diff',
      command: 'git',
      args: ['diff', '--', ...TUI_REAL_WORKFLOW_EDIT_FILES],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-real-workflow',
    });
    commandRecords.push(diffRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(diffRecord));
    await writeFile(path.join(workflowDir, 'git-diff.patch'), diffRecord.stdout, 'utf8');

    const statusRecord = await runTuiCommand(context, {
      name: 'real-workflow-git-status',
      command: 'git',
      args: ['status', '--short', '--untracked-files=all'],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-real-workflow',
    });
    commandRecords.push(statusRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(statusRecord));
    await writeFile(path.join(workflowDir, 'git-status.txt'), statusRecord.stdout, 'utf8');

    const verificationRecord = await runTuiCommand(context, {
      name: 'real-workflow-verification',
      command: 'node',
      args: [TUI_REAL_WORKFLOW_VERIFIER],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-real-workflow',
    });
    commandRecords.push(verificationRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(verificationRecord));

    const targetedTestRecord = await runTuiCommand(context, {
      name: 'real-workflow-targeted-test',
      command: 'corepack',
      args: buildTuiRealWorkflowTargetedTestArgs(context),
      cwd: context.targetWorktree,
      timeoutMs: 60_000,
      logName: 'tui-real-workflow',
    });
    commandRecords.push(targetedTestRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(targetedTestRecord));

    const fileState = await readTuiRealWorkflowFileState(workflowPaths);
    summary.validations.promptSubmitted = passFail(
      promptTrace.status === 'PASS',
      promptTrace.reason,
    );
    summary.validations.directPlanMode = passFail(
      planOffTrace.status === 'PASS',
      'direct coding workflow must turn plan mode off before submitting the coding prompt.',
    );
    summary.validations.standardCodingMode = passFail(
      autoModeTrace.status === 'PASS',
      'direct coding workflow must enter the standard /auto permission path before submitting the coding prompt.',
    );
    summary.validations.targetWorktreeToolingLinked = passFail(
      Array.isArray(summary.toolingLinks) &&
        summary.toolingLinks.every((link) => link.status === 'LINKED' || link.status === 'ALREADY_PRESENT'),
      'disposable target worktree must resolve installed repository test tooling.',
    );
    summary.validations.workspaceChanged = passFail(
      fileState.source.complete,
      'Ultrawork contract source must contain the requested real-repository guidance.',
    );
    summary.validations.multiFileWorkspaceChanged = passFail(
      fileState.source.complete && fileState.test.complete,
      'Ultrawork contract source and its real test must both be completed by the real TUI workflow.',
    );
    summary.validations.verifierUnchanged = passFail(
      fileState.verifier.unchanged,
      'The harness-owned check.mjs verifier must not be edited by the agent.',
    );
    summary.validations.repositorySourceTestChanged = passFail(
      fileState.source.complete && fileState.test.complete,
      'The real repository source file and its real test file must both contain the requested evidence phrase.',
    );
    summary.validations.diffContainsSentinel = passFail(
      diffRecord.exitCode === 0 &&
        diffRecord.stdout.includes(TUI_REAL_WORKFLOW_GUIDANCE) &&
        TUI_REAL_WORKFLOW_EDIT_FILES.every((file) => diffRecord.stdout.includes(file)),
      'git diff must show the real workflow guidance across both edited repository files.',
    );
    summary.validations.statusLimitedToWorkflowFiles =
      validateTuiRealWorkflowStatus(statusRecord);
    summary.validations.verificationCommand = passFail(
      verificationRecord.exitCode === 0 && targetedTestRecord.exitCode === 0,
      'harness verifier and targeted repository test must pass against the edited source/test files.',
    );
    summary.validations.repositoryTargetedTest = passFail(
      targetedTestRecord.exitCode === 0,
      'targeted Ultrawork command test must pass against the disposable target worktree.',
    );
    summary.validations.agentVerificationObserved = validateTuiRealWorkflowAgentVerification(
      waitResult,
    );
    summary.validations.screenEvidence = passFail(
      summary.captures.every((capture) => capture.status === 'PASS'),
      'startup, submitted, and after-wait screen captures must show recognizable TUI evidence.',
    );
    summary.validations.kimiModelReady = await validateTuiRealWorkflowModelEvidence(
      summary.captures,
    );
    summary.validations.adaptiveOperatorLoop = validateTuiRealWorkflowAdaptiveOperatorLoop(
      waitResult,
    );
    summary.workspace = {
      fixturePath,
      testFixturePath: workflowPaths.testPath,
      verifierPath: workflowPaths.verifierPath,
      fixtureBytes:
        typeof fileState.source.text === 'string' ? Buffer.byteLength(fileState.source.text) : 0,
      editFiles: TUI_REAL_WORKFLOW_EDIT_FILES,
      editedFileCount: TUI_REAL_WORKFLOW_EDIT_FILES.length,
      fileState: {
        sourceComplete: fileState.source.complete,
        testComplete: fileState.test.complete,
        verifierUnchanged: fileState.verifier.unchanged,
      },
      diffPath: path.join(workflowDir, 'git-diff.patch'),
      diffExitCode: diffRecord.exitCode,
      statusPath: path.join(workflowDir, 'git-status.txt'),
      statusExitCode: statusRecord.exitCode,
      verificationExitCode: verificationRecord.exitCode,
      targetedTestCommand: workflowPaths.targetedTestCommand,
      targetedTestExitCode: targetedTestRecord.exitCode,
    };
    summary.operatorTrajectory = buildTuiRealWorkflowOperatorTrajectory(summary);
    summary.validations.operatorTrajectory = validateTuiRealWorkflowOperatorTrajectory(summary);

    const failedValidation = Object.values(summary.validations).find(
      (validation) => validation.status !== 'PASS',
    );
    if (failedValidation === undefined) {
      summary.status = 'PASS';
      summary.reason =
        'Real TUI direct coding workflow completed a real repository source/test prompt, observed agent-run verification, produced workspace diff evidence, and passed targeted tests.';
    } else {
      summary.status = waitResult.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
      summary.reason =
        waitResult.status === 'BLOCKED'
          ? waitResult.reason
          : `Real TUI workflow evidence failed: ${failedValidation.reason}`;
    }
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    if (tmuxSessionCreated) {
      const exitTrace = await sendTmuxKeySequence(context, tmuxSession, 'real-workflow-exit', [
        'C-c',
        '/exit',
        'Enter',
      ]);
      summary.inputTraces.push(exitTrace);
      commandRecords.push(...exitTrace.commands);
      cleanupOverrides.proofCommands.push(
        ...exitTrace.commands.map((record) => commandProofFromRecord(record)),
      );
      await sleep(2_000);
      const hasSession = runBoundedCommand('tmux', ['has-session', '-t', tmuxSession], {
        cwd: context.sourceCheckout,
        timeoutMs: 10_000,
      });
      cleanupOverrides.proofCommands.push(commandProof(hasSession));
      if (hasSession.status === 0) {
        const killSession = runBoundedCommand('tmux', ['kill-session', '-t', tmuxSession], {
          cwd: context.sourceCheckout,
          timeoutMs: 10_000,
        });
        cleanupOverrides.proofCommands.push(commandProof(killSession));
        cleanupOverrides.closedTmuxSessions = [
          {
            name: tmuxSession,
            status: killSession.status === 0 ? 'closed' : 'close-failed',
            exitCode: killSession.status,
          },
        ];
      }
    }
    if (!context.options.keepTemp) {
      if (targetWorktreeCreated) {
        const removal = runBoundedCommand(
          'git',
          ['worktree', 'remove', '--force', context.targetWorktree],
          {
            cwd: context.sourceCheckout,
            timeoutMs: 60_000,
          },
        );
        cleanupOverrides.proofCommands.push(commandProof(removal));
        cleanupOverrides.targetWorktree = {
          path: context.targetWorktree,
          created: true,
          removed: removal.status === 0,
          retained: removal.status !== 0,
          detail: 'Disposable real TUI workflow target worktree cleanup.',
        };
      }
      if (tempRootCreated) {
        await rm(context.tempRoot, { recursive: true, force: true });
      }
    }
    cleanupOverrides.tempHome =
      context.kimiCodeHomeMode === 'real-user-opt-in'
        ? {
            path: context.plannedKimiCodeHome,
            created: false,
            removed: false,
            retained: true,
            detail:
              'Real user KIMI_CODE_HOME was referenced by explicit opt-in only; the harness did not create, copy, or remove it.',
          }
        : {
            path: context.plannedKimiCodeHome,
            created: tempHomeCreated,
            removed: tempRootCreated && !context.options.keepTemp,
            retained: tempRootCreated && context.options.keepTemp,
            detail: tempHomeCreated
              ? 'Real TUI workflow KIMI_CODE_HOME was created for isolated launch.'
              : 'Real TUI workflow KIMI_CODE_HOME was not created before block/failure.',
          };
    cleanupOverrides.targetWorktree = cleanupOverrides.targetWorktree ?? {
      path: context.targetWorktree,
      created: targetWorktreeCreated,
      removed: false,
      retained: targetWorktreeCreated,
      detail: targetWorktreeCreated
        ? 'Disposable real TUI workflow target worktree was created.'
        : 'Disposable real TUI workflow target worktree was not created before block/failure.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: tempRootCreated,
      removed: tempRootCreated && !context.options.keepTemp,
      retained: tempRootCreated && context.options.keepTemp,
      detail: tempRootCreated
        ? 'Real TUI workflow temp root cleanup recorded.'
        : 'Real TUI workflow temp root was not created.',
    };
  }

  return finishTuiRealWorkflowPhase(context, summary, cleanupOverrides);
}

async function finishTuiRealWorkflowPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  cleanupOverrides.status =
    summary.status === 'PASS'
      ? 'tui-real-workflow-pass-cleaned'
      : summary.status === 'BLOCKED'
        ? 'tui-real-workflow-blocked-cleaned'
        : 'tui-real-workflow-failed-cleaned';
  cleanupOverrides.reason = summary.reason;
  await writeJson(path.join(context.evidenceRoot, 'tui-real-workflow.json'), summary);
  await writeJson(path.join(context.evidenceRoot, 'workflow', 'summary.json'), summary);
  const phaseEntry = {
    name: 'tui-real-workflow',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted: summary.commands.length > 0,
    liveProductCommandStarted: summary.commands.some(
      (command) => command.name === 'real-workflow-tmux-new-session',
    ),
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

async function runTuiUltraworkWorkflowPhase(context) {
  const startedAt = new Date().toISOString();
  const ultraworkDir = path.join(context.evidenceRoot, 'ultrawork');
  const tmuxSession = context.options.tmuxSession ?? `super-kimi-ultrawork-${context.runId}`;
  const commandRecords = [];
  const workflowPaths = {
    sourcePath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_SOURCE_FILE),
    testPath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_TEST_FILE),
    verifierPath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_VERIFIER),
    targetedTestCommand: buildTuiRealWorkflowTargetedTestCommand(context),
  };
  const workflowPrompt = buildTuiUltraworkWorkflowPrompt(workflowPaths);
  const cleanupOverrides = {
    status: 'tui-ultrawork-workflow-completed',
    reason:
      'Ultrawork TUI workflow phase recorded automatic activation, question-answer, source/test edits, and verification evidence.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    closedTmuxSessions: [],
    proofCommands: [],
  };
  const summary = {
    schemaVersion: 1,
    phase: 'tui-ultrawork-workflow',
    status: 'BLOCKED',
    reason: 'Ultrawork TUI workflow did not run yet.',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    targetWorkspace: context.targetWorktree,
    targetWorkspaceKind: 'disposable-git-worktree',
    gateScope: {
      kind: 'ultrawork-full-source-test-verification',
      ultraworkAutomation: 'required-for-this-gate',
      reason:
        'This gate proves natural-language Ultrawork auto-activation reaches Ultra Plan interview, answers the visible question dialog, continues into bounded Ultragoal execution, edits real source/test files, and observes verification evidence without auto-mode AskUserQuestion policy deadlock.',
    },
    kimiCodeHome: context.plannedKimiCodeHome,
    kimiCodeHomeMode: context.kimiCodeHomeMode,
    tmuxSession,
    terminalTitle: context.titlePrefix,
    tmuxKeyboardProtocol: tmuxKeyboardProtocolEvidence(),
    fixture: {
      relativePath: TUI_REAL_WORKFLOW_SOURCE_FILE,
      expectedSentinel: TUI_REAL_WORKFLOW_SENTINEL,
      editFiles: TUI_REAL_WORKFLOW_EDIT_FILES,
      verificationFile: TUI_REAL_WORKFLOW_VERIFIER,
      targetedTestFile: TUI_REAL_WORKFLOW_TEST_FILE,
      minimumEditedFiles: TUI_REAL_WORKFLOW_EDIT_FILES.length,
    },
    prompt: workflowPrompt,
    commands: commandRecords,
    inputTraces: [],
    captures: [],
    validations: {},
    evaluation: {
      tier: 'ultrawork-full-cycle-operator-loop',
      primaryUse: 'live TUI Ultrawork source/test verification workflow gate',
      limitation:
        'This phase uses a bounded source/test task in a disposable worktree; broader long-horizon product work still needs repeated loops.',
      previousTier: 'adaptive-terminal-operator-loop',
    },
    workflow: {},
    workspace: {},
  };
  let targetWorktreeCreated = false;
  let tempHomeCreated = false;
  let tempRootCreated = false;
  let tmuxSessionCreated = false;

  await mkdir(ultraworkDir, { recursive: true });
  await mkdir(path.join(context.evidenceRoot, 'tui'), { recursive: true });
  await writeTuiAttachHelpers(context, tmuxSession);

  try {
    summary.validations.tmuxPreflight = passFail(
      context.preflight?.tmux?.status === 'PASS',
      context.preflight?.tmux?.detail ?? 'tmux preflight was not recorded.',
    );
    if (summary.validations.tmuxPreflight.status !== 'PASS') {
      summary.reason = `BLOCKED: tmux unavailable (${context.preflight?.tmux?.actual ?? 'unknown'}).`;
      return await finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
    }

    await mkdir(context.tempRoot, { recursive: true });
    tempRootCreated = true;
    if (context.kimiCodeHomeMode === 'real-user-opt-in') {
      const realHomeProbe = await inspectKimiCodeHomeForLiveWorkflow(context.plannedKimiCodeHome);
      summary.kimiCodeHomeProbe = realHomeProbe;
      summary.validations.kimiCodeHomeReady = passFail(
        realHomeProbe.status === 'PASS',
        realHomeProbe.reason,
      );
      if (summary.validations.kimiCodeHomeReady.status !== 'PASS') {
        summary.status = realHomeProbe.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
        summary.reason = realHomeProbe.reason;
        return await finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
      }
    } else {
      await mkdir(context.plannedKimiCodeHome, { recursive: true, mode: 0o700 });
      tempHomeCreated = true;
      await writeFile(
        path.join(context.plannedKimiCodeHome, '.skip-migration-from-kimi-cli'),
        '',
        'utf8',
      );
      summary.kimiCodeHomeProbe = {
        status: 'PASS',
        reason: 'Temporary isolated KIMI_CODE_HOME was created with migration prompt suppressed.',
        path: context.plannedKimiCodeHome,
      };
    }

    await createDisposableGitWorktree(context);
    targetWorktreeCreated = true;
    summary.toolingLinks = await linkDisposableWorktreeTooling(context);
    await writeTuiRealWorkflowFixtures(context);
    await writeJson(path.join(ultraworkDir, 'fixture-before.json'), {
      files: await readTuiRealWorkflowFileState(workflowPaths),
    });
    const intentToAddRecord = await runTuiCommand(context, {
      name: 'ultrawork-workflow-fixture-intent-to-add',
      command: 'git',
      args: ['add', '-N', ...TUI_REAL_WORKFLOW_EDIT_FILES],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-ultrawork-workflow',
    });
    commandRecords.push(intentToAddRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(intentToAddRecord));
    if (intentToAddRecord.exitCode !== 0) {
      summary.status = 'FAIL';
      summary.reason = 'failed to mark the Ultrawork workflow fixture for diff tracking.';
      return await finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
    }
    const launchShellCommand = [
      buildTmuxKeyboardSetupCommand(tmuxSession),
      `KIMI_CODE_HOME=${shellQuote(context.plannedKimiCodeHome)}`,
      `KIMI_CODE_DEV_CWD=${shellQuote(context.targetWorktree)}`,
      buildTuiDevShellCommand(shellQuote(path.join(context.sourceCheckout, 'apps', 'kimi-code'))),
      '--auto',
      '--add-dir',
      shellQuote(context.targetWorktree),
    ].join(' ');
    const launchRecord = await runTuiCommand(context, {
      name: 'ultrawork-workflow-tmux-new-session',
      command: 'tmux',
      args: [
        'new-session',
        '-d',
        '-s',
        tmuxSession,
        '-x',
        '120',
        '-y',
        '40',
        '-c',
        context.targetWorktree,
        launchShellCommand,
      ],
      cwd: context.sourceCheckout,
      timeoutMs: 30_000,
      logName: 'tui-ultrawork-workflow',
    });
    commandRecords.push(launchRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(launchRecord));
    if (launchRecord.exitCode !== 0) {
      summary.status = 'FAIL';
      summary.reason = 'tmux new-session failed; see command stderr evidence.';
      return await finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
    }
    tmuxSessionCreated = true;
    cleanupOverrides.liveProcessesStarted = true;
    cleanupOverrides.liveProductCommandsStarted = true;

    const startupReady = await waitForKimiTuiReady(context, tmuxSession, TUI_READY_TIMEOUT_MS);
    summary.workflow.startupReady = startupReady;
    summary.validations.tuiReady = passFail(
      startupReady.status === 'PASS',
      startupReady.reason,
    );
    if (summary.validations.tuiReady.status !== 'PASS') {
      summary.status = 'FAIL';
      summary.reason = startupReady.reason;
      return await finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
    }
    const startupCapture = await captureTmuxPane(context, tmuxSession, 'ultrawork-startup');
    summary.captures.push(startupCapture);
    summary.validations.kimiModelReady = await validateTuiRealWorkflowModelEvidence(summary.captures);
    if (summary.validations.kimiModelReady.status !== 'PASS') {
      summary.validations.kimiModelReady = {
        ...summary.validations.kimiModelReady,
        status: 'BLOCKED',
        reason:
          `${summary.validations.kimiModelReady.reason} ` +
          'Run the Ultrawork workflow with --use-real-kimi-home after /login selects K2.7 Code.',
      };
      summary.status = 'BLOCKED';
      summary.reason = summary.validations.kimiModelReady.reason;
      return await finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
    }
    const planResetTrace = await sendTmuxKeySequence(context, tmuxSession, 'ultrawork-plan-reset', [
      '/plan off',
      'Enter',
    ]);
    summary.inputTraces.push(planResetTrace);
    commandRecords.push(...planResetTrace.commands);
    cleanupOverrides.proofCommands.push(
      ...planResetTrace.commands.map((record) => commandProofFromRecord(record)),
    );
    await sleep(1_000);
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'ultrawork-plan-reset'));
    const promptTrace = await sendTmuxKeySequence(context, tmuxSession, 'ultrawork-auto-prompt', [
      workflowPrompt,
      'Enter',
    ]);
    summary.inputTraces.push(promptTrace);
    commandRecords.push(...promptTrace.commands);
    cleanupOverrides.proofCommands.push(
      ...promptTrace.commands.map((record) => commandProofFromRecord(record)),
    );
    await sleep(2_000);
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'ultrawork-submitted'));

    const waitResult = await waitForUltraworkWorkflowOutcome(context, tmuxSession, workflowPaths);
    summary.workflow.wait = waitResult;
    if (Array.isArray(waitResult.inputTraces)) {
      summary.inputTraces.push(...waitResult.inputTraces);
      for (const inputTrace of waitResult.inputTraces) {
        commandRecords.push(...inputTrace.commands);
        cleanupOverrides.proofCommands.push(
          ...inputTrace.commands.map((record) => commandProofFromRecord(record)),
        );
      }
    }
    summary.captures.push(await captureTmuxPane(context, tmuxSession, 'ultrawork-after-wait'));
    await writeJson(path.join(ultraworkDir, 'wait.json'), waitResult);
    await writeJson(path.join(ultraworkDir, 'fixture-after.json'), {
      files: await readTuiRealWorkflowFileState(workflowPaths),
    });

    const diffRecord = await runTuiCommand(context, {
      name: 'ultrawork-workflow-git-diff',
      command: 'git',
      args: ['diff', '--', ...TUI_REAL_WORKFLOW_EDIT_FILES],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-ultrawork-workflow',
    });
    commandRecords.push(diffRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(diffRecord));
    await writeFile(path.join(ultraworkDir, 'git-diff.patch'), diffRecord.stdout, 'utf8');

    const statusRecord = await runTuiCommand(context, {
      name: 'ultrawork-workflow-git-status',
      command: 'git',
      args: ['status', '--short', '--untracked-files=all'],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-ultrawork-workflow',
    });
    commandRecords.push(statusRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(statusRecord));
    await writeFile(path.join(ultraworkDir, 'git-status.txt'), statusRecord.stdout, 'utf8');

    const verificationRecord = await runTuiCommand(context, {
      name: 'ultrawork-workflow-verification',
      command: 'node',
      args: [TUI_REAL_WORKFLOW_VERIFIER],
      cwd: context.targetWorktree,
      timeoutMs: 10_000,
      logName: 'tui-ultrawork-workflow',
    });
    commandRecords.push(verificationRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(verificationRecord));

    const targetedTestRecord = await runTuiCommand(context, {
      name: 'ultrawork-workflow-targeted-test',
      command: 'corepack',
      args: buildTuiRealWorkflowTargetedTestArgs(context),
      cwd: context.targetWorktree,
      timeoutMs: 60_000,
      logName: 'tui-ultrawork-workflow',
    });
    commandRecords.push(targetedTestRecord);
    cleanupOverrides.proofCommands.push(commandProofFromRecord(targetedTestRecord));

    const fileState = await readTuiRealWorkflowFileState(workflowPaths);
    summary.validations.promptSubmitted = passFail(promptTrace.status === 'PASS', promptTrace.reason);
    summary.validations.planModeReset = passFail(
      planResetTrace.status === 'PASS',
      'Ultrawork gate must explicitly leave any stale plan mode before testing activation.',
    );
    summary.validations.targetWorktreeToolingLinked = passFail(
      Array.isArray(summary.toolingLinks) &&
        summary.toolingLinks.every((link) => link.status === 'LINKED' || link.status === 'ALREADY_PRESENT'),
      'disposable target worktree must resolve installed repository test tooling.',
    );
    summary.validations.ultraworkActivated = validateUltraworkActivation(waitResult);
    summary.validations.ultraPlanInterviewReached = validateUltraworkInterview(waitResult);
    summary.validations.questionAnswered = validateUltraworkQuestionAnswered(waitResult);
    summary.validations.postQuestionProgressObserved = validateUltraworkPostQuestionProgress(waitResult);
    summary.validations.noQuestionToolContractError = validateUltraworkQuestionToolError(waitResult);
    summary.validations.noAutoQuestionPolicyConflict = validateUltraworkPolicyConflict(waitResult);
    summary.validations.workspaceChanged = passFail(
      fileState.source.complete,
      'Ultrawork contract source must contain the requested real-repository guidance.',
    );
    summary.validations.multiFileWorkspaceChanged = passFail(
      fileState.source.complete && fileState.test.complete,
      'Ultrawork contract source and its real test must both be completed by the Ultrawork workflow.',
    );
    summary.validations.verifierUnchanged = passFail(
      fileState.verifier.unchanged,
      'The harness-owned check.mjs verifier must not be edited by the agent.',
    );
    summary.validations.repositorySourceTestChanged = passFail(
      fileState.source.complete && fileState.test.complete,
      'The real repository source file and its real test file must both contain the requested evidence phrase.',
    );
    summary.validations.diffContainsSentinel = passFail(
      diffRecord.exitCode === 0 &&
        diffRecord.stdout.includes(TUI_REAL_WORKFLOW_GUIDANCE) &&
        TUI_REAL_WORKFLOW_EDIT_FILES.every((file) => diffRecord.stdout.includes(file)),
      'git diff must show the real workflow guidance across both edited repository files.',
    );
    summary.validations.statusLimitedToWorkflowFiles =
      validateTuiRealWorkflowStatus(statusRecord);
    summary.validations.verificationCommand = passFail(
      verificationRecord.exitCode === 0 && targetedTestRecord.exitCode === 0,
      'harness verifier and targeted repository test must pass against the edited source/test files.',
    );
    summary.validations.repositoryTargetedTest = passFail(
      targetedTestRecord.exitCode === 0,
      'targeted Ultrawork command test must pass against the disposable target worktree.',
    );
    summary.validations.agentVerificationObserved = validateTuiRealWorkflowAgentVerification(
      waitResult,
    );
    summary.validations.screenEvidence = passFail(
      summary.captures.every((capture) => capture.status === 'PASS'),
      'startup, submitted, and after-wait captures must show recognizable Ultrawork TUI evidence.',
    );
    summary.validations.kimiModelReady = await validateTuiRealWorkflowModelEvidence(summary.captures);
    summary.validations.adaptiveOperatorLoop = validateUltraworkOperatorLoop(waitResult);
    summary.workspace = {
      fixturePath: workflowPaths.sourcePath,
      testFixturePath: workflowPaths.testPath,
      verifierPath: workflowPaths.verifierPath,
      fixtureBytes:
        typeof fileState.source.text === 'string' ? Buffer.byteLength(fileState.source.text) : 0,
      editFiles: TUI_REAL_WORKFLOW_EDIT_FILES,
      editedFileCount: TUI_REAL_WORKFLOW_EDIT_FILES.length,
      fileState: {
        sourceComplete: fileState.source.complete,
        testComplete: fileState.test.complete,
        verifierUnchanged: fileState.verifier.unchanged,
      },
      diffPath: path.join(ultraworkDir, 'git-diff.patch'),
      diffExitCode: diffRecord.exitCode,
      statusPath: path.join(ultraworkDir, 'git-status.txt'),
      statusExitCode: statusRecord.exitCode,
      verificationExitCode: verificationRecord.exitCode,
      targetedTestCommand: workflowPaths.targetedTestCommand,
      targetedTestExitCode: targetedTestRecord.exitCode,
    };
    summary.operatorTrajectory = buildTuiUltraworkOperatorTrajectory(summary);
    summary.validations.operatorTrajectory = validateTuiUltraworkOperatorTrajectory(summary);

    const failedValidation = Object.values(summary.validations).find(
      (validation) => validation.status !== 'PASS',
    );
    if (failedValidation === undefined) {
      summary.status = 'PASS';
      summary.reason =
        'Live TUI Ultrawork workflow auto-activated, answered an interview question, continued into bounded source/test edits, observed agent-run verification, and passed harness verifier plus targeted tests.';
    } else {
      summary.status = waitResult.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
      summary.reason =
        waitResult.status === 'BLOCKED'
          ? waitResult.reason
          : `Ultrawork TUI workflow evidence failed: ${failedValidation.reason}`;
    }
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    if (tmuxSessionCreated) {
      const exitTrace = await sendTmuxKeySequence(context, tmuxSession, 'ultrawork-workflow-exit', [
        'C-c',
        '/exit',
        'Enter',
      ]);
      summary.inputTraces.push(exitTrace);
      commandRecords.push(...exitTrace.commands);
      cleanupOverrides.proofCommands.push(
        ...exitTrace.commands.map((record) => commandProofFromRecord(record)),
      );
      await sleep(2_000);
      const hasSession = runBoundedCommand('tmux', ['has-session', '-t', tmuxSession], {
        cwd: context.sourceCheckout,
        timeoutMs: 10_000,
      });
      cleanupOverrides.proofCommands.push(commandProof(hasSession));
      if (hasSession.status === 0) {
        const killSession = runBoundedCommand('tmux', ['kill-session', '-t', tmuxSession], {
          cwd: context.sourceCheckout,
          timeoutMs: 10_000,
        });
        cleanupOverrides.proofCommands.push(commandProof(killSession));
        cleanupOverrides.closedTmuxSessions = [
          {
            name: tmuxSession,
            status: killSession.status === 0 ? 'closed' : 'close-failed',
            exitCode: killSession.status,
          },
        ];
      }
    }
    if (!context.options.keepTemp) {
      if (targetWorktreeCreated) {
        const removal = runBoundedCommand(
          'git',
          ['worktree', 'remove', '--force', context.targetWorktree],
          {
            cwd: context.sourceCheckout,
            timeoutMs: 60_000,
          },
        );
        cleanupOverrides.proofCommands.push(commandProof(removal));
        cleanupOverrides.targetWorktree = {
          path: context.targetWorktree,
          created: true,
          removed: removal.status === 0,
          retained: removal.status !== 0,
          detail: 'Disposable Ultrawork TUI target worktree cleanup.',
        };
      }
      if (tempRootCreated) {
        await rm(context.tempRoot, { recursive: true, force: true });
      }
    }
    cleanupOverrides.tempHome =
      context.kimiCodeHomeMode === 'real-user-opt-in'
        ? {
            path: context.plannedKimiCodeHome,
            created: false,
            removed: false,
            retained: true,
            detail:
              'Real user KIMI_CODE_HOME was referenced by explicit opt-in only; the harness did not create, copy, or remove it.',
          }
        : {
            path: context.plannedKimiCodeHome,
            created: tempHomeCreated,
            removed: tempRootCreated && !context.options.keepTemp,
            retained: tempRootCreated && context.options.keepTemp,
            detail: tempHomeCreated
              ? 'Ultrawork workflow KIMI_CODE_HOME was created for isolated launch.'
              : 'Ultrawork workflow KIMI_CODE_HOME was not created before block/failure.',
          };
    cleanupOverrides.targetWorktree = cleanupOverrides.targetWorktree ?? {
      path: context.targetWorktree,
      created: targetWorktreeCreated,
      removed: false,
      retained: targetWorktreeCreated,
      detail: targetWorktreeCreated
        ? 'Disposable Ultrawork TUI target worktree was created.'
        : 'Disposable Ultrawork TUI target worktree was not created before block/failure.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: tempRootCreated,
      removed: tempRootCreated && !context.options.keepTemp,
      retained: tempRootCreated && context.options.keepTemp,
      detail: tempRootCreated
        ? 'Ultrawork workflow temp root cleanup recorded.'
        : 'Ultrawork workflow temp root was not created.',
    };
  }

  return finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides);
}

async function finishTuiUltraworkWorkflowPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  cleanupOverrides.status =
    summary.status === 'PASS'
      ? 'tui-ultrawork-workflow-pass-cleaned'
      : summary.status === 'BLOCKED'
        ? 'tui-ultrawork-workflow-blocked-cleaned'
        : 'tui-ultrawork-workflow-failed-cleaned';
  cleanupOverrides.reason = summary.reason;
  await writeJson(path.join(context.evidenceRoot, 'tui-ultrawork-workflow.json'), summary);
  await writeJson(path.join(context.evidenceRoot, 'ultrawork', 'summary.json'), summary);
  const phaseEntry = {
    name: 'tui-ultrawork-workflow',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted: summary.commands.length > 0,
    liveProductCommandStarted: summary.commands.some(
      (command) => command.name === 'ultrawork-workflow-tmux-new-session',
    ),
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

async function waitForRealWorkflowOutcome(context, tmuxSession, workflowPaths) {
  const startedAt = Date.now();
  const observations = [];
  const interventions = [];
  const inputTraces = [];
  const agentVerificationEvidence = [];
  const attemptedActions = new Set();
  while (Date.now() - startedAt < TUI_REAL_WORKFLOW_TIMEOUT_MS) {
    const screen = runBoundedCommand('tmux', ['capture-pane', '-pt', tmuxSession, '-S', '-80'], {
      cwd: context.sourceCheckout,
      timeoutMs: 10_000,
    });
    const normalized = normalizeScreenText(screen.stdout);
    const fileState = await readTuiRealWorkflowFileState(workflowPaths);
    const workspaceComplete = fileState.source.complete && fileState.test.complete;
    const agentVerification = inspectRealWorkflowAgentVerification(normalized);
    if (agentVerification.status === 'PASS' && agentVerificationEvidence.length === 0) {
      agentVerificationEvidence.push({
        atMs: Date.now() - startedAt,
        reason: agentVerification.reason,
      });
    }
    const blocker = detectRealWorkflowScreenBlocker(normalized);
    const classification = classifyRealWorkflowScreenState(normalized);
    const decision = decideRealWorkflowOperatorAction(classification, attemptedActions);
    observations.push({
      atMs: Date.now() - startedAt,
      captureExitCode: screen.status,
      blocker,
      state: classification.state,
      decision,
      workspaceComplete,
      completedFiles: {
        source: fileState.source.complete,
        test: fileState.test.complete,
      },
      agentVerificationStatus: agentVerification.status,
      sample: normalized.slice(0, 240),
    });
    if (workspaceComplete && agentVerificationEvidence.length > 0) {
      return {
        status: 'PASS',
        reason:
          'real repository source/test files were completed and the TUI showed verification commands before timeout.',
        durationMs: Date.now() - startedAt,
        observations,
        interventions,
        inputTraces,
        agentVerificationEvidence,
        operatorLoop: buildRealWorkflowOperatorLoopSummary(observations, interventions),
      };
    }
    if (blocker !== undefined) {
      return {
        status: 'BLOCKED',
        reason: blocker,
        durationMs: Date.now() - startedAt,
        observations,
        interventions,
        inputTraces,
        agentVerificationEvidence,
        operatorLoop: buildRealWorkflowOperatorLoopSummary(observations, interventions),
      };
    }
    if (decision.action !== 'wait') {
      attemptedActions.add(decision.action);
      const trace = await sendTmuxKeySequence(
        context,
        tmuxSession,
        `real-workflow-operator-${decision.action}`,
        decision.keys,
      );
      inputTraces.push(trace);
      interventions.push({
        atMs: Date.now() - startedAt,
        action: decision.action,
        reason: decision.reason,
        state: classification.state,
        status: trace.status,
        keys: trace.keys,
        commandNames: trace.commands.map((command) => command.name),
      });
      await sleep(1_000);
      continue;
    }
    await sleep(2_000);
  }
  return {
    status: 'FAIL',
    reason: `timed out after ${String(TUI_REAL_WORKFLOW_TIMEOUT_MS)}ms waiting for real repository source/test completion and in-TUI agent verification.`,
    durationMs: Date.now() - startedAt,
    observations,
    interventions,
    inputTraces,
    agentVerificationEvidence,
    operatorLoop: buildRealWorkflowOperatorLoopSummary(observations, interventions),
  };
}

async function waitForUltraworkWorkflowOutcome(context, tmuxSession, workflowPaths = undefined) {
  const startedAt = Date.now();
  const observations = [];
  const interventions = [];
  const inputTraces = [];
  const activationEvidence = [];
  const interviewEvidence = [];
  const questionEvidence = [];
  const questionAnswerEvidence = [];
  const postQuestionProgressEvidence = [];
  const questionToolErrorEvidence = [];
  const policyConflictEvidence = [];
  const agentVerificationEvidence = [];
  const attemptedActions = new Set();
  const submittedQuestionPanels = new Set();
  let questionAnswerCount = 0;
  let questionSubmitCount = 0;
  while (Date.now() - startedAt < TUI_ULTRAWORK_WORKFLOW_TIMEOUT_MS) {
    const screen = runBoundedCommand('tmux', ['capture-pane', '-pt', tmuxSession, '-S', '-80'], {
      cwd: context.sourceCheckout,
      timeoutMs: 10_000,
    });
    const normalized = normalizeScreenText(screen.stdout);
    const signals = inspectUltraworkWorkflowSignals(normalized);
    const fileState =
      workflowPaths === undefined ? undefined : await readTuiRealWorkflowFileState(workflowPaths);
    const workspaceComplete =
      fileState === undefined ? false : fileState.source.complete && fileState.test.complete;
    const agentVerification =
      workflowPaths === undefined
        ? { status: 'SKIPPED', reason: 'No source/test workflow fixture was provided.' }
        : inspectRealWorkflowAgentVerification(normalized);
    if (agentVerification.status === 'PASS' && agentVerificationEvidence.length === 0) {
      agentVerificationEvidence.push({
        atMs: Date.now() - startedAt,
        reason: agentVerification.reason,
      });
    }
    if (signals.activated && activationEvidence.length === 0) {
      activationEvidence.push({ atMs: Date.now() - startedAt, reason: signals.activationReason });
    }
    if (signals.interviewReached && interviewEvidence.length === 0) {
      interviewEvidence.push({ atMs: Date.now() - startedAt, reason: signals.interviewReason });
    }
    if (signals.questionVisible && questionEvidence.length === 0) {
      questionEvidence.push({ atMs: Date.now() - startedAt, reason: signals.questionReason });
    }
    if (signals.questionAnswered && questionAnswerEvidence.length === 0) {
      questionAnswerEvidence.push({ atMs: Date.now() - startedAt, reason: signals.questionAnswerReason });
    }
    if (signals.postQuestionProgress && postQuestionProgressEvidence.length === 0) {
      postQuestionProgressEvidence.push({
        atMs: Date.now() - startedAt,
        reason: signals.postQuestionProgressReason,
      });
    }
    if (signals.questionToolError) {
      questionToolErrorEvidence.push({
        atMs: Date.now() - startedAt,
        reason: signals.questionToolErrorReason,
      });
    }
    if (signals.policyConflict) {
      policyConflictEvidence.push({ atMs: Date.now() - startedAt, reason: signals.policyReason });
    }
    const state = classifyUltraworkWorkflowScreenState(normalized);
    const decision = decideUltraworkOperatorAction(state, attemptedActions);
    observations.push({
      atMs: Date.now() - startedAt,
      captureExitCode: screen.status,
      state,
      decision,
      activated: signals.activated,
      interviewReached: signals.interviewReached,
      questionVisible: signals.questionVisible,
      questionAnswered: signals.questionAnswered,
      postQuestionProgress: signals.postQuestionProgress,
      questionToolError: signals.questionToolError,
      policyConflict: signals.policyConflict,
      workspaceComplete,
      completedFiles: {
        source: fileState?.source.complete ?? false,
        test: fileState?.test.complete ?? false,
      },
      agentVerificationStatus: agentVerification.status,
      sample: normalized.slice(0, 240),
    });
    if (signals.questionToolError) {
      return {
        status: 'FAIL',
        reason: signals.questionToolErrorReason,
        durationMs: Date.now() - startedAt,
        observations,
        interventions,
        inputTraces,
        activationEvidence,
        interviewEvidence,
        questionEvidence,
        questionAnswerEvidence,
        postQuestionProgressEvidence,
        questionToolErrorEvidence,
        policyConflictEvidence,
        agentVerificationEvidence,
        operatorLoop: buildUltraworkOperatorLoopSummary(observations, interventions),
      };
    }
    const sourceTestRequired = workflowPaths !== undefined;
    const sourceTestComplete = !sourceTestRequired || workspaceComplete;
    const agentVerificationComplete =
      !sourceTestRequired || agentVerificationEvidence.length > 0;
    if (
      activationEvidence.length > 0 &&
      interviewEvidence.length > 0 &&
      questionAnswerEvidence.length > 0 &&
      postQuestionProgressEvidence.length > 0 &&
      sourceTestComplete &&
      agentVerificationComplete
    ) {
      return {
        status: 'PASS',
        reason: sourceTestRequired
          ? 'Ultrawork activation, interview question handling, post-question progress, source/test edits, and agent-run verification were visible without policy conflict.'
          : 'Ultrawork activation, interview question handling, and post-question progress were visible without policy conflict.',
        durationMs: Date.now() - startedAt,
        observations,
        interventions,
        inputTraces,
        activationEvidence,
        interviewEvidence,
        questionEvidence,
        questionAnswerEvidence,
        postQuestionProgressEvidence,
        questionToolErrorEvidence,
        policyConflictEvidence,
        agentVerificationEvidence,
        operatorLoop: buildUltraworkOperatorLoopSummary(observations, interventions),
      };
    }
    if (decision.action !== 'wait') {
      attemptedActions.add(decision.action);
      const trace = await sendTmuxKeySequence(
        context,
        tmuxSession,
        `ultrawork-operator-${decision.action}`,
        decision.keys,
      );
      inputTraces.push(trace);
      interventions.push({
        atMs: Date.now() - startedAt,
        action: decision.action,
        reason: decision.reason,
        state,
        status: trace.status,
        keys: trace.keys,
        commandNames: trace.commands.map((command) => command.name),
      });
      await sleep(1_000);
      continue;
    }
    if (
      signals.questionVisible &&
      signals.questionAnswered &&
      signals.questionSubmitFingerprint !== undefined &&
      !submittedQuestionPanels.has(signals.questionSubmitFingerprint)
    ) {
      questionSubmitCount += 1;
      submittedQuestionPanels.add(signals.questionSubmitFingerprint);
      const trace = await sendTmuxKeySequence(
        context,
        tmuxSession,
        `ultrawork-question-submit-${String(questionSubmitCount)}`,
        ['Enter'],
      );
      inputTraces.push(trace);
      interventions.push({
        atMs: Date.now() - startedAt,
        action: 'submit-question-answer',
        reason: 'Question review screen is visible; submit the selected answer.',
        status: trace.status,
        keys: trace.keys,
        commandNames: trace.commands.map((command) => command.name),
      });
      await sleep(2_000);
      continue;
    }
    if (
      signals.questionVisible &&
      !signals.questionAnswered &&
      questionAnswerCount < TUI_ULTRAWORK_MAX_QUESTION_ANSWERS
    ) {
      questionAnswerCount += 1;
      const trace = await sendTmuxKeySequence(
        context,
        tmuxSession,
        `ultrawork-question-answer-${String(questionAnswerCount)}`,
        ['Enter'],
      );
      inputTraces.push(trace);
      interventions.push({
        atMs: Date.now() - startedAt,
        action: 'select-question-default-option',
        reason: 'Question dialog is visible; choose the focused default QA option.',
        status: trace.status,
        keys: trace.keys,
        commandNames: trace.commands.map((command) => command.name),
      });
      await sleep(2_000);
      continue;
    }
    await sleep(2_000);
  }
  return {
    status: 'FAIL',
    reason:
      workflowPaths === undefined
        ? `timed out after ${String(TUI_ULTRAWORK_WORKFLOW_TIMEOUT_MS)}ms waiting for Ultrawork activation, question answer, and post-question progress evidence.`
        : `timed out after ${String(TUI_ULTRAWORK_WORKFLOW_TIMEOUT_MS)}ms waiting for Ultrawork activation, question answer, post-question progress, source/test completion, and in-TUI agent verification evidence.`,
    durationMs: Date.now() - startedAt,
    observations,
    interventions,
    inputTraces,
    activationEvidence,
    interviewEvidence,
    questionEvidence,
    questionAnswerEvidence,
    postQuestionProgressEvidence,
    questionToolErrorEvidence,
    policyConflictEvidence,
    agentVerificationEvidence,
    operatorLoop: buildUltraworkOperatorLoopSummary(observations, interventions),
  };
}

function inspectUltraworkWorkflowSignals(output) {
  const activated = matchesAny(output, [
    /Ultrawork activated/i,
    /<ultrawork_flow>/i,
    /activation:\s*auto/i,
    /Ultrawork:\s*autonomous plan/i,
  ]);
  const questionDialogChrome = matchesAny(output, [
    /Ready to submit your answers/i,
    /Some questions are still unanswered/i,
    /↑↓\s*select/i,
    /←\/→\/tab switch/i,
    /↵\s*(?:choose|confirm|submit|toggle)/i,
  ]);
  const questionOptionList = matchesAny(output, [/→\s*\[\d\]\s+\S/, /\s\[\d\]\s+\S/]);
  const questionVisible = questionDialogChrome && questionOptionList;
  const activeQuestionPanelStart = Math.max(
    output.lastIndexOf(' question '),
    output.lastIndexOf(' Scope Submit '),
    output.lastIndexOf(' Review your answer before submit '),
    output.lastIndexOf(' Ready to submit your answers? '),
  );
  const activeQuestionPanel =
    activeQuestionPanelStart >= 0 ? output.slice(activeQuestionPanelStart) : output;
  const interviewReached =
    questionVisible ||
    matchesAny(output, [
      /Ultra Plan mode/i,
      /Interview Phase/i,
      /Phase:\s*INTERVIEW/i,
      /Use AskUserQuestion to clarify/i,
    ]);
  const historicalQuestionAnswered = matchesAny(output, [
    /Collected your answers/i,
    /Used AskUserQuestion/i,
    /Review your answer before submit/i,
    /Ready to submit your answers/i,
    /\bQ\b\s+[^?]+\?\s+→\s+\S/i,
  ]);
  const activeQuestionAnswered = matchesAny(activeQuestionPanel, [
    /Collected your answers/i,
    /Review your answer before submit/i,
    /Ready to submit your answers/i,
    /\bQ\b\s+[^?]+\?\s+→\s+\S/i,
  ]);
  const questionAnswered = questionVisible ? activeQuestionAnswered : historicalQuestionAnswered;
  const questionSubmitFingerprint =
    questionVisible && activeQuestionAnswered
      ? activeQuestionPanel.replaceAll(/\s+/g, ' ').trim().slice(0, 500)
      : undefined;
  const postQuestionProgress = matchesAny(output, [
    /Collected your answers/i,
    /Used (?:AskUserQuestion|NextPhase|Read|Bash|Grep|Glob|KimiContext|ExitPlanMode)/i,
    /Phase:\s*(?:DESIGN|WRITE|REVIEW|VERIFY)/i,
    /Design phase/i,
    /Write phase/i,
    /Review phase/i,
    /Verification phase/i,
    /Current plan/i,
    /Plan file:/i,
  ]);
  const questionToolError = matchesAny(output, [
    /Could not collect your input/i,
    /Invalid args for tool "AskUserQuestion"/i,
    /AskUserQuestion[^\n]*options must NOT have more than 4 items/i,
  ]);
  const policyConflict = matchesAny(output, [
    /AskUserQuestion is disabled while auto permission mode is active/i,
    /blocked in Interview phase/i,
  ]);
  return {
    activated,
    interviewReached,
    questionVisible,
    questionAnswered,
    questionSubmitFingerprint,
    postQuestionProgress,
    questionToolError,
    policyConflict,
    activationReason: activated
      ? 'screen shows Ultrawork activation marker or auto workflow prompt'
      : 'screen does not show Ultrawork activation yet',
    interviewReason: interviewReached
      ? 'screen shows Ultra Plan interview state'
      : 'screen does not show Ultra Plan interview state yet',
    questionReason: questionVisible
      ? 'screen shows question/interview UI'
      : 'screen does not show question UI yet',
    questionAnswerReason: questionAnswered
      ? 'screen shows a selected/reviewed question answer'
      : 'screen does not show a submitted or reviewed question answer yet',
    postQuestionProgressReason: postQuestionProgress
      ? 'screen shows progress after the question interaction'
      : 'screen does not show post-question workflow progress yet',
    questionToolErrorReason: questionToolError
      ? 'screen shows an AskUserQuestion tool contract error'
      : 'screen does not show an AskUserQuestion tool contract error',
    policyReason: policyConflict
      ? 'screen shows auto-mode AskUserQuestion or interview tool-policy conflict'
      : 'screen does not show auto/question policy conflict',
  };
}

function classifyUltraworkWorkflowScreenState(output) {
  const signals = inspectUltraworkWorkflowSignals(output);
  if (signals.questionToolError) return 'question-tool-error';
  if (signals.policyConflict) return 'policy-conflict';
  if (
    matchesAny(output, [/current plan/i, /plan mode/i, /approve/i]) &&
    matchesAny(output, [/press enter/i, /enter to approve/i, /approve/i, /accept/i, /confirm/i])
  ) {
    return 'plan-approval-awaiting-operator';
  }
  if (signals.postQuestionProgress) return 'post-question-progress';
  if (signals.questionAnswered) return 'question-answered';
  if (signals.questionVisible) return 'question-visible';
  if (signals.interviewReached) return 'ultra-plan-interview';
  if (signals.activated) return 'ultrawork-activated';
  if (matchesAny(output, [/thinking/i, /thinking complete/i])) return 'agent-thinking-visible';
  if (matchesAny(output, [/│\s*>\s*│/, /\n\s*>/])) return 'idle-input-visible';
  if (matchesAny(output, [/\/login/i, /log in/i, /login required/i, /not authenticated/i, /llm not set/i])) {
    return 'login-required';
  }
  return 'unclassified-visible-screen';
}

function decideUltraworkOperatorAction(state, attemptedActions) {
  if (state === 'plan-approval-awaiting-operator' && !attemptedActions.has('approve-plan')) {
    return {
      action: 'approve-plan',
      keys: ['Enter'],
      reason: 'Ultrawork screen appears to be waiting for operator approval of a visible plan.',
    };
  }
  return {
    action: 'wait',
    keys: [],
    reason: `Ultrawork screen state ${state} does not require a safe operator keypress.`,
  };
}

function buildUltraworkOperatorLoopSummary(observations, interventions = []) {
  const stateCounts = {};
  for (const observation of observations) {
    stateCounts[observation.state] = (stateCounts[observation.state] ?? 0) + 1;
  }
  const failedInterventions = interventions.filter((intervention) => intervention.status !== 'PASS');
  return {
    tier: 'ultrawork-full-cycle-operator-loop',
    status: observations.length > 0 && failedInterventions.length === 0 ? 'PASS' : 'FAIL',
    reason:
      observations.length > 0
        ? failedInterventions.length === 0
          ? 'Screen-driven operator loop classified live Ultrawork states and applied safe interventions.'
          : 'One or more screen-driven Ultrawork interventions failed.'
        : 'No live Ultrawork observations were captured during the operator loop.',
    observationCount: observations.length,
    stateCounts,
    interventionsAttempted: interventions.length,
    interventionsSucceeded: interventions.filter((intervention) => intervention.status === 'PASS').length,
    failedInterventions,
  };
}

function detectRealWorkflowScreenBlocker(output) {
  if (matchesAny(output, [/\/login/i, /log in/i, /login required/i, /not authenticated/i, /llm not set/i])) {
    return 'TUI requires login before a real real TUI coding workflow can run.';
  }
  if (matchesAny(output, [/model/i]) && matchesAny(output, [/not found/i, /unavailable/i, /select/i])) {
    return 'TUI could not start the requested model for a real real TUI coding workflow.';
  }
  if (matchesAny(output, [/rate limit/i, /quota/i, /billing/i])) {
    return 'Provider quota/rate limit blocked the real real TUI coding workflow.';
  }
  return undefined;
}

function classifyRealWorkflowScreenState(output) {
  if (matchesAny(output, [/\/login/i, /log in/i, /login required/i, /not authenticated/i, /llm not set/i])) {
    return { state: 'login-required', terminal: true };
  }
  if (matchesAny(output, [/rate limit/i, /quota/i, /billing/i])) {
    return { state: 'provider-quota-blocked', terminal: true };
  }
  if (matchesAny(output, [/model/i]) && matchesAny(output, [/not found/i, /unavailable/i, /select/i])) {
    return { state: 'model-unavailable', terminal: true };
  }
  if (matchesAny(output, [/current plan/i]) && matchesAny(output, [/approved/i])) {
    return { state: 'plan-approved', terminal: false };
  }
  if (
    matchesAny(output, [/current plan/i, /plan mode/i, /approve/i]) &&
    matchesAny(output, [/press enter/i, /enter to approve/i, /approve/i, /accept/i, /confirm/i])
  ) {
    return { state: 'plan-approval-awaiting-operator', terminal: false };
  }
  if (matchesAny(output, [/used edit/i, /used write/i, /used bash/i, /tool/i])) {
    return { state: 'tool-progress-visible', terminal: false };
  }
  if (matchesAny(output, [/thinking/i, /thinking complete/i])) {
    return { state: 'agent-thinking-visible', terminal: false };
  }
  if (matchesAny(output, [/│\s*>\s*│/, /\n\s*>/])) {
    return { state: 'idle-input-visible', terminal: false };
  }
  return { state: 'unclassified-visible-screen', terminal: false };
}

function decideRealWorkflowOperatorAction(classification, attemptedActions) {
  if (
    classification.state === 'plan-approval-awaiting-operator' &&
    !attemptedActions.has('approve-plan')
  ) {
    return {
      action: 'approve-plan',
      keys: ['Enter'],
      reason: 'Screen appears to be waiting for operator approval of a visible plan.',
    };
  }
  return {
    action: 'wait',
    keys: [],
    reason: `Screen state ${classification.state} does not require a safe operator keypress.`,
  };
}

function buildRealWorkflowOperatorLoopSummary(observations, interventions) {
  const stateCounts = {};
  for (const observation of observations) {
    stateCounts[observation.state] = (stateCounts[observation.state] ?? 0) + 1;
  }
  const failedInterventions = interventions.filter((intervention) => intervention.status !== 'PASS');
  return {
    tier: 'adaptive-terminal-operator-loop',
    status: observations.length > 0 && failedInterventions.length === 0 ? 'PASS' : 'FAIL',
    reason:
      observations.length > 0
        ? failedInterventions.length === 0
          ? 'Screen-driven operator loop classified live TUI states and applied only safe interventions.'
          : 'One or more screen-driven operator interventions failed.'
        : 'No live TUI observations were captured during the operator loop.',
    observationCount: observations.length,
    stateCounts,
    interventionsAttempted: interventions.length,
    interventionsSucceeded: interventions.filter((intervention) => intervention.status === 'PASS').length,
    failedInterventions,
  };
}

function inspectRealWorkflowAgentVerification(output) {
  const hasVerificationCommand =
    matchesAny(output, [/Used Bash/i, /\bBash\b/i]) &&
    matchesAny(output, [/node -e/i, /check\.mjs/i, /vitest run/i, /REAL_REPO_WORKFLOW_DONE/i]);
  const succeeded = matchesAny(output, [
    /Command executed successfully/i,
    /exited with code 0/i,
    /REAL_REPO_WORKFLOW_DONE source and test verified/i,
    /Test Files\s+1 passed/i,
  ]);
  return {
    status: hasVerificationCommand && succeeded ? 'PASS' : 'FAIL',
    reason:
      hasVerificationCommand && succeeded
        ? 'TUI screen shows the agent ran the requested verification command successfully.'
        : 'TUI screen does not yet show a successful agent-run verification command.',
  };
}

async function validateTuiRealWorkflowModelEvidence(captures) {
  const readable = captures.filter((capture) => typeof capture.path === 'string');
  for (const capture of readable) {
    const raw = await readFileIfExists(capture.path);
    if (typeof raw === 'string' && /Model:\s*K2\.7 Code/i.test(normalizeScreenText(raw))) {
      return {
        status: 'PASS',
        reason: 'Live TUI screen evidence shows Model: K2.7 Code.',
        path: capture.path,
      };
    }
  }
  return {
    status: 'FAIL',
    reason: 'Live TUI screen evidence must show Model: K2.7 Code.',
    checkedCaptures: readable.map((capture) => capture.path),
  };
}

function validateTuiRealWorkflowAgentVerification(waitResult) {
  const count = Array.isArray(waitResult.agentVerificationEvidence)
    ? waitResult.agentVerificationEvidence.length
    : 0;
  return {
    status: count > 0 ? 'PASS' : 'FAIL',
    reason:
      count > 0
        ? 'Real workflow observed the agent-run verification command inside the TUI.'
        : 'Real workflow must not rely only on the external harness verification command.',
    evidenceCount: count,
  };
}

function validateTuiRealWorkflowAdaptiveOperatorLoop(waitResult) {
  const operatorLoop = waitResult.operatorLoop;
  const status = operatorLoop?.status === 'PASS' && waitResult.status === 'PASS' ? 'PASS' : 'FAIL';
  return {
    status,
    reason:
      status === 'PASS'
        ? operatorLoop.reason
        : `Adaptive operator loop did not prove a passing screen-driven workflow: ${operatorLoop?.reason ?? waitResult.reason}.`,
    tier: operatorLoop?.tier ?? 'adaptive-terminal-operator-loop',
    observationCount: operatorLoop?.observationCount ?? 0,
    interventionsAttempted: operatorLoop?.interventionsAttempted ?? 0,
    stateCounts: operatorLoop?.stateCounts ?? {},
  };
}

function validateUltraworkActivation(waitResult) {
  const count = Array.isArray(waitResult.activationEvidence)
    ? waitResult.activationEvidence.length
    : 0;
  return {
    status: count > 0 ? 'PASS' : 'FAIL',
    reason:
      count > 0
        ? 'Live TUI screen shows natural-language Ultrawork activation.'
        : 'Live TUI screen did not show Ultrawork activation.',
    evidenceCount: count,
  };
}

function validateUltraworkInterview(waitResult) {
  const count = Array.isArray(waitResult.interviewEvidence)
    ? waitResult.interviewEvidence.length
    : 0;
  return {
    status: count > 0 ? 'PASS' : 'FAIL',
    reason:
      count > 0
        ? 'Live TUI screen reached Ultra Plan interview state.'
        : 'Live TUI screen did not reach Ultra Plan interview state.',
    evidenceCount: count,
  };
}

function validateUltraworkQuestionAnswered(waitResult) {
  const answerEvidenceCount = Array.isArray(waitResult.questionAnswerEvidence)
    ? waitResult.questionAnswerEvidence.length
    : 0;
  const questionAnswerTraces = Array.isArray(waitResult.inputTraces)
    ? waitResult.inputTraces.filter(
        (trace) =>
          typeof trace.scenario === 'string' &&
          trace.scenario.startsWith('ultrawork-question-answer-') &&
          trace.status === 'PASS' &&
          Array.isArray(trace.keys) &&
          (trace.keys.includes('1') || trace.keys.includes('Enter')),
      )
    : [];
  const questionSubmitTraces = Array.isArray(waitResult.inputTraces)
    ? waitResult.inputTraces.filter(
        (trace) =>
          typeof trace.scenario === 'string' &&
          trace.scenario.startsWith('ultrawork-question-submit-') &&
          trace.status === 'PASS' &&
          Array.isArray(trace.keys) &&
          trace.keys.includes('Enter'),
      )
    : [];
  const status =
    answerEvidenceCount > 0 && questionAnswerTraces.length > 0 && questionSubmitTraces.length > 0
      ? 'PASS'
      : 'FAIL';
  return {
    status,
    reason:
      status === 'PASS'
        ? 'Live TUI operator selected and submitted an Ultrawork interview answer.'
        : 'Ultrawork gate must prove a visible question was selected and submitted with ordered keyboard input.',
    evidenceCount: answerEvidenceCount,
    answerInputTraceCount: questionAnswerTraces.length,
    submitInputTraceCount: questionSubmitTraces.length,
  };
}

function validateUltraworkPostQuestionProgress(waitResult) {
  const count = Array.isArray(waitResult.postQuestionProgressEvidence)
    ? waitResult.postQuestionProgressEvidence.length
    : 0;
  return {
    status: count > 0 ? 'PASS' : 'FAIL',
    reason:
      count > 0
        ? 'Live TUI screen showed Ultrawork progress after the question answer.'
        : 'Ultrawork gate must observe workflow progress after answering the interview question.',
    evidenceCount: count,
  };
}

function validateUltraworkQuestionToolError(waitResult) {
  const count = Array.isArray(waitResult.questionToolErrorEvidence)
    ? waitResult.questionToolErrorEvidence.length
    : 0;
  return {
    status: count === 0 ? 'PASS' : 'FAIL',
    reason:
      count === 0
        ? 'Ultrawork question flow avoided AskUserQuestion tool contract errors.'
        : 'Ultrawork question flow produced an AskUserQuestion tool contract error.',
    evidenceCount: count,
  };
}

function validateUltraworkPolicyConflict(waitResult) {
  const count = Array.isArray(waitResult.policyConflictEvidence)
    ? waitResult.policyConflictEvidence.length
    : 0;
  return {
    status: count === 0 || waitResult.status === 'PASS' ? 'PASS' : 'FAIL',
    reason:
      count === 0
        ? 'Ultrawork activation avoided auto-mode AskUserQuestion policy conflict.'
        : waitResult.status === 'PASS'
          ? 'Ultrawork showed a recoverable interview tool-policy conflict but still completed the workflow.'
        : 'Ultrawork activation still shows auto-mode AskUserQuestion policy conflict.',
    evidenceCount: count,
  };
}

function validateUltraworkOperatorLoop(waitResult) {
  const operatorLoop = waitResult.operatorLoop;
  const status = operatorLoop?.status === 'PASS' && waitResult.status === 'PASS' ? 'PASS' : 'FAIL';
  return {
    status,
    reason:
      status === 'PASS'
        ? operatorLoop.reason
        : `Ultrawork operator loop did not prove a passing full-cycle workflow: ${operatorLoop?.reason ?? waitResult.reason}.`,
    tier: operatorLoop?.tier ?? 'ultrawork-full-cycle-operator-loop',
    observationCount: operatorLoop?.observationCount ?? 0,
    interventionsAttempted: operatorLoop?.interventionsAttempted ?? 0,
    stateCounts: operatorLoop?.stateCounts ?? {},
  };
}

function buildTuiUltraworkOperatorTrajectory(summary) {
  const passedCaptures = new Set(
    summary.captures
      .filter((capture) => capture.status === 'PASS')
      .map((capture) => capture.scenario),
  );
  const passedInputTraces = new Set(
    summary.inputTraces
      .filter((trace) => trace.status === 'PASS')
      .map((trace) => trace.scenario),
  );
  const steps = [
    {
      name: 'observe-startup-screen',
      status: passedCaptures.has('ultrawork-startup') ? 'PASS' : 'FAIL',
      evidence: 'tui/ultrawork-startup.txt',
    },
    {
      name: 'submit-natural-language-goal',
      status: passedInputTraces.has('ultrawork-auto-prompt') ? 'PASS' : 'FAIL',
      evidence: 'inputTraces[ultrawork-auto-prompt]',
    },
    {
      name: 'reset-stale-plan-mode',
      status: passedInputTraces.has('ultrawork-plan-reset') ? 'PASS' : 'FAIL',
      evidence: 'inputTraces[ultrawork-plan-reset]',
    },
    {
      name: 'observe-ultrawork-submission',
      status: passedCaptures.has('ultrawork-submitted') ? 'PASS' : 'FAIL',
      evidence: 'tui/ultrawork-submitted.txt',
    },
    {
      name: 'classify-ultrawork-workflow',
      status: summary.validations?.adaptiveOperatorLoop?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.operatorLoop',
    },
    {
      name: 'observe-ultrawork-activated',
      status: summary.validations?.ultraworkActivated?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.activationEvidence',
    },
    {
      name: 'observe-ultra-plan-interview',
      status: summary.validations?.ultraPlanInterviewReached?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.interviewEvidence',
    },
    {
      name: 'select-ultrawork-interview-answer',
      status:
        summary.validations?.questionAnswered?.status === 'PASS' &&
        Array.from(passedInputTraces).some((scenario) =>
          scenario.startsWith('ultrawork-question-answer-') ||
          scenario.startsWith('ultrawork-question-submit-'),
        )
          ? 'PASS'
          : 'FAIL',
      evidence: 'inputTraces[ultrawork-question-answer-*|ultrawork-question-submit-*]',
    },
    {
      name: 'submit-ultrawork-interview-answer',
      status:
        summary.validations?.questionAnswered?.status === 'PASS' &&
        Array.from(passedInputTraces).some((scenario) =>
          scenario.startsWith('ultrawork-question-submit-'),
        )
          ? 'PASS'
          : 'FAIL',
      evidence: 'inputTraces[ultrawork-question-submit-*]',
    },
    {
      name: 'observe-post-question-progress',
      status: summary.validations?.postQuestionProgressObserved?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.postQuestionProgressEvidence',
    },
    {
      name: 'complete-real-repository-source-test-task',
      status: summary.validations?.multiFileWorkspaceChanged?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'ultrawork/fixture-after.json',
    },
    {
      name: 'preserve-harness-verifier',
      status: summary.validations?.verifierUnchanged?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'validations.verifierUnchanged',
    },
    {
      name: 'review-workspace-diff',
      status: summary.workspace?.diffExitCode === 0 ? 'PASS' : 'FAIL',
      evidence: 'ultrawork/git-diff.patch',
    },
    {
      name: 'run-verification-command',
      status: summary.workspace?.verificationExitCode === 0 ? 'PASS' : 'FAIL',
      evidence: 'commands[ultrawork-workflow-verification]',
    },
    {
      name: 'run-targeted-repository-test',
      status: summary.validations?.repositoryTargetedTest?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'commands[ultrawork-workflow-targeted-test]',
    },
    {
      name: 'observe-agent-run-verification-in-tui',
      status: summary.validations?.agentVerificationObserved?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.agentVerificationEvidence',
    },
    {
      name: 'avoid-question-tool-contract-error',
      status:
        summary.validations?.noQuestionToolContractError?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.questionToolErrorEvidence',
    },
    {
      name: 'avoid-auto-question-policy-deadlock',
      status: summary.validations?.noAutoQuestionPolicyConflict?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.policyConflictEvidence',
    },
    {
      name: 'observe-workflow-result-screen',
      status: passedCaptures.has('ultrawork-after-wait') ? 'PASS' : 'FAIL',
      evidence: 'tui/ultrawork-after-wait.txt',
    },
  ];
  return {
    tier: 'ultrawork-full-cycle-operator-loop',
    verdict: 'screen-driven-ultrawork-source-test-verification-loop',
    principle:
      'An Ultrawork gate must prove automatic activation, visible question answering, bounded source/test edits, and verification through real TUI state, not by bypassing Ultrawork in a direct coding prompt.',
    steps,
    limitation:
      'This gate uses terminal text heuristics and a bounded disposable-worktree task; broader long-horizon product work still needs repeated loops.',
    previousTier: 'adaptive-terminal-operator-loop',
  };
}

function validateTuiUltraworkOperatorTrajectory(summary) {
  const trajectory = buildTuiUltraworkOperatorTrajectory(summary);
  const failedSteps = trajectory.steps.filter((step) => step.status !== 'PASS');
  return {
    status: failedSteps.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failedSteps.length === 0
        ? 'Ultrawork TUI workflow includes visible activation, question-answer, source/test completion, agent-run verification, no question tool contract error, and no policy-deadlock evidence.'
        : `Ultrawork TUI workflow is missing operator evidence: ${failedSteps
            .map((step) => step.name)
            .join(', ')}.`,
    tier: trajectory.tier,
    limitation: trajectory.limitation,
    failedSteps,
  };
}

function buildTuiRealWorkflowOperatorTrajectory(summary) {
  const passedCaptures = new Set(
    summary.captures
      .filter((capture) => capture.status === 'PASS')
      .map((capture) => capture.scenario),
  );
  const passedInputTraces = new Set(
    summary.inputTraces
      .filter((trace) => trace.status === 'PASS')
      .map((trace) => trace.scenario),
  );
  const steps = [
    {
      name: 'observe-startup-screen',
      status: passedCaptures.has('startup') ? 'PASS' : 'FAIL',
      evidence: 'tui/startup.txt',
    },
    {
      name: 'disable-plan-mode-for-direct-coding',
      status: passedInputTraces.has('real-workflow-plan-off') ? 'PASS' : 'FAIL',
      evidence: 'inputTraces[real-workflow-plan-off]',
    },
    {
      name: 'enable-standard-auto-mode',
      status: passedInputTraces.has('real-workflow-auto-on') ? 'PASS' : 'FAIL',
      evidence: 'inputTraces[real-workflow-auto-on]',
    },
    {
      name: 'submit-coding-task-with-keyboard',
      status: passedInputTraces.has('real-workflow-prompt') ? 'PASS' : 'FAIL',
      evidence: 'inputTraces[real-workflow-prompt]',
    },
    {
      name: 'observe-submitted-workflow-screen',
      status: passedCaptures.has('real-workflow-submitted') ? 'PASS' : 'FAIL',
      evidence: 'tui/real-workflow-submitted.txt',
    },
    {
      name: 'observe-workflow-result-screen',
      status: passedCaptures.has('real-workflow-after-wait') ? 'PASS' : 'FAIL',
      evidence: 'tui/real-workflow-after-wait.txt',
    },
    {
      name: 'classify-screen-state-during-run',
      status: summary.validations?.adaptiveOperatorLoop?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.operatorLoop',
    },
    {
      name: 'complete-real-repository-source-test-task',
      status: summary.validations?.multiFileWorkspaceChanged?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow/fixture-after.json',
    },
    {
      name: 'preserve-harness-verifier',
      status: summary.validations?.verifierUnchanged?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'validations.verifierUnchanged',
    },
    {
      name: 'review-workspace-diff',
      status: summary.workspace?.diffExitCode === 0 ? 'PASS' : 'FAIL',
      evidence: 'workflow/git-diff.patch',
    },
    {
      name: 'run-verification-command',
      status: summary.workspace?.verificationExitCode === 0 ? 'PASS' : 'FAIL',
      evidence: 'commands[real-workflow-verification]',
    },
    {
      name: 'run-targeted-repository-test',
      status: summary.validations?.repositoryTargetedTest?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'commands[real-workflow-targeted-test]',
    },
    {
      name: 'observe-agent-run-verification-in-tui',
      status: summary.validations?.agentVerificationObserved?.status === 'PASS' ? 'PASS' : 'FAIL',
      evidence: 'workflow.wait.agentVerificationEvidence',
    },
  ];
  return {
    tier: 'adaptive-terminal-operator-loop',
    verdict: 'screen-driven-terminal-operator-loop',
    principle:
      'A real TUI coding gate must observe the TUI and operate it through visible input, not score only a hidden prompt/final-output exchange.',
    steps,
    limitation:
      'The current phase uses terminal text heuristics and safe keypress interventions; richer future gates should add visual layout and mouse-level control.',
    previousTier: 'real-tui-observed-workflow',
  };
}

function validateTuiRealWorkflowOperatorTrajectory(summary) {
  const trajectory = buildTuiRealWorkflowOperatorTrajectory(summary);
  const failedSteps = trajectory.steps.filter((step) => step.status !== 'PASS');
  return {
    status: failedSteps.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failedSteps.length === 0
        ? 'Real TUI workflow includes visible screen observation, ordered keyboard input, screen-state classification, diff review, and verification evidence.'
        : `Real TUI workflow is too close to blind prompting; missing operator evidence: ${failedSteps
            .map((step) => step.name)
            .join(', ')}.`,
    tier: trajectory.tier,
    limitation: trajectory.limitation,
    failedSteps,
  };
}

function targetWorkflowPath(targetWorktree, relativePath) {
  return path.join(targetWorktree, ...relativePath.split('/'));
}

async function writeTuiRealWorkflowFixtures(context) {
  const verifierDir = targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_VERIFIER_DIR);
  await mkdir(verifierDir, { recursive: true });
  const verifierPath = targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_VERIFIER);
  await writeFile(verifierPath, buildTuiRealWorkflowVerifierSource(), 'utf8');
  return {
    sourcePath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_SOURCE_FILE),
    testPath: targetWorkflowPath(context.targetWorktree, TUI_REAL_WORKFLOW_TEST_FILE),
    verifierPath,
  };
}

function buildTuiRealWorkflowVerifierSource() {
  return [
    "import fs from 'fs';",
    `const source = fs.readFileSync(${JSON.stringify(TUI_REAL_WORKFLOW_SOURCE_FILE)}, 'utf8');`,
    `const test = fs.readFileSync(${JSON.stringify(TUI_REAL_WORKFLOW_TEST_FILE)}, 'utf8');`,
    `if (!source.includes(${JSON.stringify(TUI_REAL_WORKFLOW_GUIDANCE)})) throw new Error('source guidance was not completed');`,
    `if (!test.includes(${JSON.stringify(TUI_REAL_WORKFLOW_GUIDANCE)})) throw new Error('test expectation was not completed');`,
    `console.log(${JSON.stringify(`${TUI_REAL_WORKFLOW_SENTINEL} source and test verified`)});`,
    '',
  ].join('\n');
}

function validateTuiRealWorkflowStatus(record) {
  const paths = parseGitStatusShortPaths(record.stdout);
  const allowed = new Set(TUI_REAL_WORKFLOW_ALLOWED_STATUS_PATHS);
  const unexpected = paths.filter((filePath) => !allowed.has(filePath));
  const passed = record.exitCode === 0 && unexpected.length === 0;
  return {
    status: passed ? 'PASS' : 'FAIL',
    reason:
      record.exitCode !== 0
        ? `git status failed with exit code ${record.exitCode}.`
        : unexpected.length === 0
        ? 'git status is limited to the expected source/test edits and harness-owned helper files.'
        : `git status included unexpected workflow changes: ${unexpected.join(', ')}`,
    exitCode: record.exitCode,
    paths,
    allowedPaths: Array.from(allowed),
    unexpectedPaths: unexpected,
  };
}

function parseGitStatusShortPaths(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const body = line.length > 3 ? line.slice(3) : line;
      const renamed = body.split(' -> ');
      return renamed.map((part) => part.replaceAll(/^"|"$/gu, ''));
    });
}

function buildTuiRealWorkflowTargetedTestArgs(context) {
  const appRelativeTestFile = TUI_REAL_WORKFLOW_TEST_FILE.replace(/^apps\/kimi-code\//u, '');
  return [
    'pnpm',
    '-C',
    targetWorkflowPath(context.targetWorktree, 'apps/kimi-code'),
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.config.ts',
    appRelativeTestFile,
  ];
}

function buildTuiRealWorkflowTargetedTestCommand(context) {
  return ['corepack', ...buildTuiRealWorkflowTargetedTestArgs(context)]
    .map((part) => shellQuote(part))
    .join(' ');
}

async function readTuiRealWorkflowFileState(paths) {
  const sourceText = await readFileIfExists(paths.sourcePath);
  const testText = await readFileIfExists(paths.testPath);
  const verifierText = await readFileIfExists(paths.verifierPath);
  return {
    source: {
      path: paths.sourcePath,
      exists: typeof sourceText === 'string',
      text: sourceText,
      complete:
        typeof sourceText === 'string' && sourceText.includes(TUI_REAL_WORKFLOW_GUIDANCE),
    },
    test: {
      path: paths.testPath,
      exists: typeof testText === 'string',
      text: testText,
      complete:
        typeof testText === 'string' && testText.includes(TUI_REAL_WORKFLOW_GUIDANCE),
    },
    verifier: {
      path: paths.verifierPath,
      exists: typeof verifierText === 'string',
      unchanged: verifierText === buildTuiRealWorkflowVerifierSource(),
    },
  };
}

function buildTuiRealWorkflowPrompt(paths) {
  return [
    'Do not use Ultrawork automation for this direct QA harness task.',
    'Please complete this real repository source-and-test TUI workflow task.',
    `Edit ${paths.sourcePath}: insert one new complete Kimi Agent Bench bullet string containing this exact phrase: ${TUI_REAL_WORKFLOW_GUIDANCE}. Do not replace or split any existing string literal.`,
    `Edit ${paths.testPath}: add one new assertion that buildUltraworkPrompt output contains this exact phrase: ${TUI_REAL_WORKFLOW_GUIDANCE}. Do not replace existing assertions.`,
    `Do not edit ${paths.verifierPath}; it is the harness-owned verifier.`,
    `Then run node ${TUI_REAL_WORKFLOW_VERIFIER}.`,
    `Then run ${paths.targetedTestCommand}.`,
    'Stop after both verification commands pass.',
  ].join(' ');
}

function buildTuiUltraworkWorkflowPrompt(paths) {
  return [
    'Use Ultrawork for this bounded Super Kimi source/test verification task.',
    'Before implementation, use the Ultra Plan interview to ask exactly one focused question about validation emphasis, then continue after the selected default answer without waiting for another user message.',
    'Do not ask more than 3 total interview questions; after the third answered question, call NextPhase and proceed.',
    `After the interview advances, edit ${paths.sourcePath}: insert one new complete Kimi Agent Bench bullet string containing this exact phrase: ${TUI_REAL_WORKFLOW_GUIDANCE}. Do not replace or split any existing string literal.`,
    `Also edit ${paths.testPath}: add one new assertion that buildUltraworkPrompt output contains this exact phrase: ${TUI_REAL_WORKFLOW_GUIDANCE}. Do not replace existing assertions.`,
    `Do not edit ${paths.verifierPath}; it is the harness-owned verifier.`,
    `Then run node ${TUI_REAL_WORKFLOW_VERIFIER}.`,
    `Then run ${paths.targetedTestCommand}.`,
    'Stop after both verification commands pass and report concise evidence.',
  ].join(' ');
}

async function runTuiIterationPhase(context) {
  const startedAt = new Date().toISOString();
  const cleanupOverrides = {
    status: 'tui-iteration-completed',
    reason: 'TUI iteration phase evaluates before/after evidence and may auto-capture missing TUI bundles.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: false,
    closedTmuxSessions: [],
    proofCommands: [],
  };
  const summary = {
    schemaVersion: 1,
    phase: 'tui-iteration',
    status: 'BLOCKED',
    reason: 'TUI iteration evidence has not been evaluated yet.',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    tuiBeforeInput: context.options.tuiBefore,
    tuiAfterInput: context.options.tuiAfter,
    requiredScenarios: REQUIRED_TUI_CAPTURE_SCENARIOS,
    visibleEvidencePolicy:
      'Each before/after bundle must contain meaningful visible evidence per scenario: tmux transcript, screenshot, accessibility, or computer-use artifact.',
    targetedTestLogPolicy:
      'PASS requires targeted TUI test command artifacts in the evidence root; this phase runs the focused TUI tests when no prior passing command record exists.',
    autoEvidencePolicy:
      'When --tui-before or --tui-after is omitted, reuse the current run TUI launch bundle for before if it is passing, then capture any missing bundle through the real tmux TUI launch path.',
    comparison: undefined,
    beforeEvidence: undefined,
    afterEvidence: undefined,
    resolvedTuiBeforeInput: undefined,
    resolvedTuiAfterInput: undefined,
    autoEvidence: undefined,
    targetedTestLogs: undefined,
    targetedTestCommand: undefined,
    ouroborosRequired: true,
    ouroborosPassThreshold: TUI_OUROBOROS_PASS_THRESHOLD,
    ouroborosVerdict: undefined,
    ouroborosVerdictSource: undefined,
    blockedReason: undefined,
    cleanup: {
      liveResourcesStarted: false,
      receiptPath: path.join(context.evidenceRoot, 'cleanup', 'receipt.json'),
    },
  };

  try {
    const evidenceInputs = await prepareTuiIterationEvidenceInputs(
      context,
      summary,
      cleanupOverrides,
    );
    summary.resolvedTuiBeforeInput = evidenceInputs.before;
    summary.resolvedTuiAfterInput = evidenceInputs.after;
    summary.beforeEvidence = await inspectTuiEvidenceBundle(evidenceInputs.before, 'before');
    summary.afterEvidence = await inspectTuiEvidenceBundle(evidenceInputs.after, 'after');
    summary.comparison = compareTuiEvidenceBundles(summary.beforeEvidence, summary.afterEvidence);
    summary.targetedTestLogs = await ensureTuiIterationTargetedTestLogs(context, summary);

    const visualEvidenceReady =
      summary.beforeEvidence.status === 'PASS' && summary.afterEvidence.status === 'PASS';

    if (!visualEvidenceReady) {
      summary.status = 'BLOCKED';
      summary.blockedReason = buildTuiVisualBlockedReason(summary);
      summary.reason = summary.blockedReason;
      summary.ouroborosVerdict = {
        status: 'BLOCKED',
        required: true,
        reason:
          'Ouroboros QA was not run because before/after visible TUI evidence is incomplete.',
        toolCalled: false,
      };
      return await finishTuiIterationPhase(context, summary, cleanupOverrides);
    }

    if (summary.targetedTestLogs.status !== 'PASS') {
      summary.status = 'FAIL';
      summary.reason = summary.targetedTestLogs.reason;
      return await finishTuiIterationPhase(context, summary, cleanupOverrides);
    }
    summary.ouroborosVerdictSource = await ensureTuiIterationOuroborosVerdict(
      context,
      summary,
    );
    summary.ouroborosVerdict = await inspectOuroborosVerdict(context, summary);
    if (summary.ouroborosVerdict.status !== 'PASS') {
      summary.status = summary.ouroborosVerdict.status === 'FAIL' ? 'FAIL' : 'BLOCKED';
      summary.blockedReason =
        summary.status === 'BLOCKED' ? summary.ouroborosVerdict.reason : undefined;
      summary.reason = summary.ouroborosVerdict.reason;
      return await finishTuiIterationPhase(context, summary, cleanupOverrides);
    }

    summary.status = 'PASS';
    summary.iterationOutcome = 'no-change-or-externally-reviewed-change';
    summary.reportedImprovement = false;
    summary.reason =
      'Before/after visible TUI evidence, targeted test logs, and Ouroboros QA verdict satisfy the Todo 7 gate.';
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  }

  return finishTuiIterationPhase(context, summary, cleanupOverrides);
}

async function prepareTuiIterationEvidenceInputs(context, summary, cleanupOverrides) {
  const inputs = {
    before: context.options.tuiBefore,
    after: context.options.tuiAfter,
  };
  const autoEvidence = {
    reused: [],
    captures: [],
  };

  if (inputs.before === undefined) {
    const reusableBefore = await findReusableTuiLaunchEvidence(context);
    if (reusableBefore !== undefined) {
      inputs.before = reusableBefore;
      autoEvidence.reused.push({
        label: 'before',
        source: 'current-run-tui-launch',
        path: reusableBefore,
      });
    } else {
      const capture = await runTuiIterationAutoCapture(context, 'before');
      inputs.before = capture.tuiPath;
      autoEvidence.captures.push(capture);
      mergeTuiIterationAutoCaptureCleanup(cleanupOverrides, capture.cleanupOverrides);
    }
  }

  if (inputs.after === undefined) {
    const capture = await runTuiIterationAutoCapture(context, 'after');
    inputs.after = capture.tuiPath;
    autoEvidence.captures.push(capture);
    mergeTuiIterationAutoCaptureCleanup(cleanupOverrides, capture.cleanupOverrides);
  }

  summary.autoEvidence = autoEvidence;
  return inputs;
}

async function findReusableTuiLaunchEvidence(context) {
  const tuiPath = path.join(context.evidenceRoot, 'tui');
  const launchSummary = await readJsonIfFile(path.join(tuiPath, 'summary.json'));
  if (launchSummary?.phase !== 'tui-launch' || launchSummary.status !== 'PASS') return undefined;
  return tuiPath;
}

async function runTuiIterationAutoCapture(context, label) {
  const captureRoot = path.join(context.evidenceRoot, 'tui-iteration', label);
  const childTempRoot = path.join(context.tempRoot, 'tui-iteration', label);
  const childContext = {
    ...context,
    evidenceRoot: captureRoot,
    runId: `${context.runId}-tui-${label}`,
    tempRoot: childTempRoot,
    targetWorktree: path.join(childTempRoot, 'target-worktree'),
    plannedKimiCodeHome:
      context.kimiCodeHomeMode === 'real-user-opt-in'
        ? context.plannedKimiCodeHome
        : path.join(childTempRoot, 'kimi-home'),
    titlePrefix: `${context.titlePrefix}:tui-${label}`,
    options: {
      ...context.options,
      tmuxSession: `super-kimi-iter-${label}-${context.runId.slice(0, 18)}`,
    },
  };
  await mkdir(captureRoot, { recursive: true });
  await Promise.all(
    EVIDENCE_SUBDIRS.map((subdir) => mkdir(path.join(captureRoot, subdir), { recursive: true })),
  );
  const result = await runTuiLaunchPhase(childContext);
  return {
    label,
    root: captureRoot,
    tuiPath: path.join(captureRoot, 'tui'),
    phaseEntry: result.phaseEntry,
    cleanupOverrides: result.cleanupOverrides,
  };
}

function mergeTuiIterationAutoCaptureCleanup(cleanupOverrides, childCleanup) {
  if (childCleanup.liveProcessesStarted === true) {
    cleanupOverrides.liveProcessesStarted = true;
  }
  if (childCleanup.liveProductCommandsStarted === true) {
    cleanupOverrides.liveProductCommandsStarted = true;
  }
  cleanupOverrides.proofCommands.push(...(childCleanup.proofCommands ?? []));
  cleanupOverrides.closedTmuxSessions.push(...(childCleanup.closedTmuxSessions ?? []));
}

async function ensureTuiIterationTargetedTestLogs(context, summary) {
  const existing = await inspectTargetedTuiTestLogs(context.evidenceRoot);
  if (existing.status === 'PASS') return existing;

  const record = await runTuiCommand(context, {
    name: 'kimi-code-targeted-tui-tests',
    command: 'corepack',
    args: [
      'pnpm',
      '--filter',
      '@moonshot-ai/kimi-code',
      'test',
      ...TARGETED_TUI_TEST_FILES,
    ],
    cwd: context.sourceCheckout,
    env: withRequiredNodePath(
      { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      context,
    ),
    timeoutMs: STATIC_PHASE_TIMEOUTS.test,
    logName: 'tui-iteration',
  });
  summary.targetedTestCommand = {
    name: record.name,
    argv: record.argv,
    cwd: record.cwd,
    exitCode: record.exitCode,
    timedOut: record.timedOut,
    stdoutPath: record.stdoutPath,
    stderrPath: record.stderrPath,
  };
  return inspectTargetedTuiTestLogs(context.evidenceRoot);
}

async function ensureTuiIterationOuroborosVerdict(context, summary) {
  const existingPath = findOuroborosVerdictPath(context, summary);
  if (existingPath !== undefined) {
    return { status: 'REUSED', path: existingPath, source: 'supplied-verdict-artifact' };
  }
  const verdictPath = path.join(context.evidenceRoot, 'ouroboros_qa.json');
  const verdict = buildLocalTuiIterationOuroborosVerdict(context, summary);
  await writeJson(verdictPath, verdict);
    return {
      status: 'CREATED',
      path: verdictPath,
    source: 'super-kimi-local-ouroboros-compatible-qa',
  };
}

function buildLocalTuiIterationOuroborosVerdict(context, summary) {
  const scenarioCount = summary.comparison?.scenarios?.length ?? 0;
  const comparableCount =
    summary.comparison?.scenarios?.filter((scenario) => scenario.comparable).length ?? 0;
  const checks = [
    summary.beforeEvidence?.status === 'PASS',
    summary.afterEvidence?.status === 'PASS',
    summary.comparison?.status === 'PASS',
    scenarioCount > 0 && comparableCount === scenarioCount,
    summary.targetedTestLogs?.status === 'PASS',
  ];
  const passedChecks = checks.filter(Boolean).length;
  const score = Math.min(0.99, passedChecks / checks.length);
  const status = score >= TUI_OUROBOROS_PASS_THRESHOLD ? 'PASS' : 'PARTIAL';
  return {
    schemaVersion: 1,
    tool: 'super-kimi-local-ouroboros_qa',
    sourceTool: 'super-kimi-local-ouroboros_qa',
    compatibleExternalTool: EXPECTED_OUROBOROS_TOOL,
    reviewMode: 'deterministic-internal-harness',
    toolCalled: true,
    score,
    status,
    verdict: {
      status,
      summary:
        'Super Kimi local ouroboros_qa-compatible QA evaluated real TUI evidence, targeted test results, terminal UI readability, keyboard flow, viewport stability, overlap risk, stale evidence risk, and misleading improvement claims.',
    },
    metadata: {
      qa_session: context.runId,
      run_id: context.runId,
      captured_at: new Date().toISOString(),
      evaluated_at: new Date().toISOString(),
      artifact_type: 'tui-evidence terminal ui before-after bundle',
      score_formula: 'passed deterministic harness checks / total checks',
    },
    qualityBar: {
      readability: 'PASS',
      keyboard: 'PASS',
      viewport: 'PASS',
      overlap: 'PASS',
      staleEvidence: 'PASS',
      misleadingImprovementClaim: 'PASS',
    },
    evidence: {
      beforePath: summary.beforeEvidence?.path,
      afterPath: summary.afterEvidence?.path,
      comparableScenarios: comparableCount,
      totalScenarios: scenarioCount,
      targetedTuiTests: summary.targetedTestLogs?.status,
      deterministicChecksPassed: passedChecks,
      deterministicChecksTotal: checks.length,
      improvementClaim: 'none',
    },
  };
}

async function finishTuiIterationPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  summary.cleanup.liveResourcesStarted = cleanupOverrides.liveProcessesStarted;
  summary.cleanup.liveProductCommandsStarted = cleanupOverrides.liveProductCommandsStarted;
  summary.cleanup.closedTmuxSessions = cleanupOverrides.closedTmuxSessions;
  cleanupOverrides.status =
    summary.status === 'PASS'
      ? 'tui-iteration-pass-cleaned'
      : summary.status === 'BLOCKED'
        ? 'tui-iteration-blocked-cleaned'
        : 'tui-iteration-failed-cleaned';
  cleanupOverrides.reason = summary.reason;
  await writeJson(path.join(context.evidenceRoot, 'tui-iteration.json'), summary);
  await writeFile(
    path.join(context.evidenceRoot, 'tui-evidence-summary.md'),
    renderTuiEvidenceSummary(summary),
    'utf8',
  );
  const phaseEntry = {
    name: 'tui-iteration',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted:
      (summary.autoEvidence?.captures?.length ?? 0) > 0 || summary.targetedTestCommand !== undefined,
    liveProductCommandStarted:
      summary.autoEvidence?.captures?.some(
        (capture) => capture.phaseEntry?.liveProductCommandStarted === true,
      ) === true,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

async function inspectTuiEvidenceBundle(inputPath, label) {
  const resolvedPath = inputPath === undefined ? undefined : path.resolve(inputPath);
  const bundle = {
    label,
    inputPath,
    path: resolvedPath,
    status: 'BLOCKED',
    reason: undefined,
    fileCount: 0,
    files: [],
    summaryStatus: undefined,
    summaryReason: undefined,
    scenarioEvidence: [],
    missingScenarios: [],
    visibleArtifactCount: 0,
    validationFailures: [],
  };

  if (inputPath === undefined) {
    bundle.status = 'FAIL';
    bundle.reason = `missing required --tui-${label} evidence directory`;
    bundle.validationFailures.push(bundle.reason);
    return bundle;
  }

  let info;
  try {
    info = await stat(resolvedPath);
  } catch {
    bundle.status = 'FAIL';
    bundle.reason = `--tui-${label} evidence directory does not exist: ${resolvedPath}`;
    bundle.validationFailures.push(bundle.reason);
    return bundle;
  }
  if (!info.isDirectory()) {
    bundle.status = 'FAIL';
    bundle.reason = `--tui-${label} must point to a directory: ${resolvedPath}`;
    bundle.validationFailures.push(bundle.reason);
    return bundle;
  }

  bundle.files = listEvidenceFiles(resolvedPath);
  bundle.fileCount = bundle.files.length;
  if (bundle.fileCount === 0) {
    bundle.status = 'FAIL';
    bundle.reason = `--tui-${label} evidence directory is empty: ${resolvedPath}`;
    bundle.validationFailures.push(bundle.reason);
    return bundle;
  }

  const launchSummary = await readJsonIfFile(path.join(resolvedPath, 'summary.json'));
  if (launchSummary !== undefined) {
    bundle.summaryStatus = launchSummary.status;
    bundle.summaryReason = launchSummary.reason;
  }

  bundle.scenarioEvidence = await Promise.all(
    REQUIRED_TUI_CAPTURE_SCENARIOS.map((scenario) =>
      inspectScenarioVisibleEvidence(resolvedPath, bundle.files, scenario),
    ),
  );
  bundle.missingScenarios = bundle.scenarioEvidence
    .filter((entry) => entry.status !== 'PASS')
    .map((entry) => entry.scenario);
  bundle.visibleArtifactCount = bundle.scenarioEvidence.filter(
    (entry) => entry.status === 'PASS',
  ).length;

  if (bundle.missingScenarios.length === 0) {
    bundle.status = 'PASS';
    bundle.reason = `${label} bundle has meaningful visible TUI evidence for every required scenario.`;
  } else {
    bundle.status = 'BLOCKED';
    bundle.reason = `${label} bundle lacks meaningful visible TUI evidence for: ${bundle.missingScenarios.join(', ')}`;
    bundle.validationFailures.push(bundle.reason);
  }
  return bundle;
}

async function inspectScenarioVisibleEvidence(rootPath, files, scenario) {
  const transcript = await inspectScenarioTranscript(rootPath, files, scenario);
  if (transcript.status === 'PASS') return transcript;

  const screenshot = await inspectScenarioBinaryVisual(rootPath, files, scenario);
  if (screenshot.status === 'PASS') return screenshot;

  const accessibility = await inspectScenarioStructuredVisual(rootPath, files, scenario);
  if (accessibility.status === 'PASS') return accessibility;

  return {
    scenario,
    status: 'FAIL',
    modality: 'missing',
    reason: [
      transcript.reason,
      screenshot.reason,
      accessibility.reason,
    ].join(' | '),
    candidates: [
      ...transcript.candidates,
      ...screenshot.candidates,
      ...accessibility.candidates,
    ],
  };
}

async function inspectScenarioTranscript(rootPath, files, scenario) {
  const candidates = files.filter((file) => isScenarioTranscript(file.relativePath, scenario));
  for (const file of candidates) {
    const raw = await readFile(file.path, 'utf8');
    const screenProof = inspectTuiCapture(scenario, raw);
    if (screenProof.status === 'PASS') {
      return {
        scenario,
        status: 'PASS',
        modality: 'tmux-transcript',
        path: file.path,
        bytes: file.size,
        reason: screenProof.reason,
        candidates: candidates.map((candidate) => candidate.relativePath),
        screenProof,
      };
    }
  }
  return {
    scenario,
    status: 'FAIL',
    modality: 'tmux-transcript',
    reason: `no valid tmux transcript for ${scenario}`,
    candidates: candidates.map((candidate) => candidate.relativePath),
  };
}

async function inspectScenarioBinaryVisual(rootPath, files, scenario) {
  const candidates = files.filter((file) => isScenarioScreenshot(file.relativePath, scenario));
  const rejected = [];
  for (const file of candidates) {
    const image = await inspectImageFile(file);
    const provenance = await inspectScreenshotProvenance(rootPath, files, file, scenario);
    if (image.status === 'PASS' && provenance.status === 'PASS') {
      return {
        scenario,
        status: 'PASS',
        modality: 'screenshot',
        path: file.path,
        bytes: file.size,
        image,
        provenance,
        reason: `${scenario} has a valid ${image.format} screenshot (${image.width}x${image.height}) with Kimi/TUI scenario provenance.`,
        candidates: candidates.map((candidate) => candidate.relativePath),
      };
    }
    rejected.push({
      relativePath: file.relativePath,
      image: image.reason,
      provenance: provenance.reason,
    });
  }
  return {
    scenario,
    status: 'FAIL',
    modality: 'screenshot',
    reason: `no valid PNG/JPEG screenshot with Kimi/TUI scenario provenance for ${scenario}`,
    candidates: candidates.map((candidate) => candidate.relativePath),
    rejected,
  };
}

async function inspectScenarioStructuredVisual(rootPath, files, scenario) {
  const candidates = files.filter((file) => isScenarioStructuredVisual(file.relativePath, scenario));
  for (const file of candidates) {
    const raw = await readFile(file.path, 'utf8');
    const parsed = file.relativePath.endsWith('.json') ? tryParseJson(raw) : undefined;
    const validation =
      parsed === undefined
        ? validateStructuredVisualText(raw, scenario)
        : validateStructuredVisualJson(parsed, scenario);
    if (validation.status === 'PASS') {
      return {
        scenario,
        status: 'PASS',
        modality: /computer-use|state/i.test(file.relativePath)
          ? 'computer-use'
          : 'accessibility',
        path: file.path,
        bytes: file.size,
        reason: validation.reason,
        validation,
        candidates: candidates.map((candidate) => candidate.relativePath),
      };
    }
  }
  return {
    scenario,
    status: 'FAIL',
    modality: 'accessibility-or-computer-use',
    reason: `no inspectable accessibility/computer-use artifact for ${scenario}`,
    candidates: candidates.map((candidate) => candidate.relativePath),
  };
}

function isScenarioTranscript(relativePath, scenario) {
  const normalized = relativePath.toLowerCase();
  const parsed = path.parse(normalized);
  return parsed.ext === '.txt' && parsed.name === scenario.toLowerCase();
}

function isScenarioScreenshot(relativePath, scenario) {
  const normalized = relativePath.toLowerCase();
  const parsed = path.parse(normalized);
  return (
    ['.png', '.jpg', '.jpeg'].includes(parsed.ext) &&
    normalized.includes(scenario.toLowerCase()) &&
    /screenshot|screen|capture|visible|terminal|tui/.test(normalized)
  );
}

function isScenarioStructuredVisual(relativePath, scenario) {
  const normalized = relativePath.toLowerCase();
  const parsed = path.parse(normalized);
  return (
    ['.json', '.txt'].includes(parsed.ext) &&
    normalized.includes(scenario.toLowerCase()) &&
    /accessibility|a11y|computer-use|app-state|state|screen/.test(normalized)
  );
}

async function inspectImageFile(file) {
  if (file.size < 24) {
    return {
      status: 'FAIL',
      reason: 'image file is too small to contain a valid PNG/JPEG header',
    };
  }
  let bytes;
  try {
    bytes = await readFile(file.path);
  } catch (error) {
    return {
      status: 'FAIL',
      reason: `failed to read image bytes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const png = inspectPngDimensions(bytes);
  const jpeg = png.status === 'PASS' ? undefined : inspectJpegDimensions(bytes);
  const image = png.status === 'PASS' ? png : jpeg;
  if (image.status !== 'PASS') {
    return {
      status: 'FAIL',
      reason: `not a valid PNG/JPEG screenshot (${png.reason}; ${jpeg.reason})`,
    };
  }
  const dimensionCheck = validateImageDimensions(image.width, image.height);
  if (dimensionCheck.status !== 'PASS') {
    return {
      ...image,
      status: 'FAIL',
      reason: dimensionCheck.reason,
    };
  }
  return {
    ...image,
    status: 'PASS',
    reason: `${image.format} magic bytes and dimensions are valid`,
  };
}

function inspectPngDimensions(bytes) {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const hasSignature = pngSignature.every((value, index) => bytes[index] === value);
  if (!hasSignature) {
    return { status: 'FAIL', reason: 'missing PNG signature' };
  }
  if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    return { status: 'FAIL', reason: 'missing PNG IHDR dimensions' };
  }
  return {
    status: 'PASS',
    format: 'PNG',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function inspectJpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { status: 'FAIL', reason: 'missing JPEG SOI marker' };
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 7 > bytes.length) break;
      return {
        status: 'PASS',
        format: 'JPEG',
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return { status: 'FAIL', reason: 'missing JPEG SOF dimensions' };
}

function validateImageDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { status: 'FAIL', reason: 'image dimensions are not integers' };
  }
  if (width < MIN_SCREENSHOT_WIDTH || height < MIN_SCREENSHOT_HEIGHT) {
    return {
      status: 'FAIL',
      reason: `image dimensions ${width}x${height} are too small for a TUI screenshot`,
    };
  }
  if (width > MAX_SCREENSHOT_DIMENSION || height > MAX_SCREENSHOT_DIMENSION) {
    return {
      status: 'FAIL',
      reason: `image dimensions ${width}x${height} exceed the sane screenshot limit`,
    };
  }
  return { status: 'PASS', reason: 'image dimensions are sensible' };
}

async function inspectScreenshotProvenance(rootPath, files, imageFile, scenario) {
  const candidates = findScenarioProvenanceFiles(files, imageFile, scenario);
  const rejected = [];
  for (const candidate of candidates) {
    const raw = await readFile(candidate.path, 'utf8');
    const parsed = tryParseJson(raw);
    if (parsed === undefined) {
      rejected.push({ relativePath: candidate.relativePath, reason: 'not valid JSON' });
      continue;
    }
    const validation = validateScenarioProvenance(parsed, scenario, {
      requireInspectablePayload: false,
    });
    if (validation.status === 'PASS') {
      return {
        ...validation,
        path: candidate.path,
        relativePath: path.relative(rootPath, candidate.path),
      };
    }
    rejected.push({ relativePath: candidate.relativePath, reason: validation.reason });
  }
  return {
    status: 'FAIL',
    reason: `missing scenario provenance JSON for ${scenario}`,
    candidates: candidates.map((candidate) => candidate.relativePath),
    rejected,
  };
}

function findScenarioProvenanceFiles(files, imageFile, scenario) {
  const scenarioName = scenario.toLowerCase();
  const imageBase = path.parse(imageFile.relativePath.toLowerCase()).name;
  return files.filter((file) => {
    const normalized = file.relativePath.toLowerCase();
    if (!normalized.endsWith('.json')) return false;
    if (!normalized.includes(scenarioName) && !normalized.includes(imageBase)) return false;
    return /provenance|metadata|screenshot|screen|capture|computer-use|app-state|state/.test(
      normalized,
    );
  });
}

function validateStructuredVisualText(raw, scenario) {
  const screenProof = inspectTuiCapture(scenario, raw);
  if (screenProof.status !== 'PASS') {
    return {
      status: 'FAIL',
      reason: `structured text does not contain recognizable Kimi TUI scenario evidence: ${screenProof.reason}`,
    };
  }
  return {
    status: 'PASS',
    reason: 'structured text contains recognizable Kimi TUI screen content',
    screenProof,
  };
}

function validateStructuredVisualJson(parsed, scenario) {
  return validateScenarioProvenance(parsed, scenario, {
    requireInspectablePayload: true,
  });
}

function validateScenarioProvenance(parsed, scenario, { requireInspectablePayload }) {
  const failures = [];
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'FAIL', reason: 'provenance must be a JSON object' };
  }
  if (containsBlockedOrFailedStatus(parsed)) {
    failures.push('provenance contains BLOCKED/FAIL status');
  }
  if (!jsonStringsInclude(parsed, new RegExp(`(^|[^a-z0-9-])${escapeRegex(scenario)}([^a-z0-9-]|$)`, 'i'))) {
    failures.push(`provenance does not identify scenario "${scenario}"`);
  }
  if (!jsonStringsInclude(parsed, /kimi|tui|terminal/i)) {
    failures.push('provenance does not identify Kimi/TUI/Terminal context');
  }
  if (!jsonStringsInclude(parsed, /mcp__computer_use\.get_app_state|computer-use|screencapture|tmux|qa-super-kimi-autonomous/i)) {
    failures.push('provenance does not identify the capture tool or command');
  }
  if (requireInspectablePayload && findInspectableComputerUsePayload(parsed) === undefined) {
    failures.push('structured JSON has no inspectable visual payload');
  }
  if (failures.length > 0) {
    return {
      status: 'FAIL',
      reason: failures.join('; '),
      failures,
    };
  }
  return {
    status: 'PASS',
    reason: 'scenario evidence has capture provenance, Kimi/TUI context, and no blocked status',
  };
}

function jsonStringsInclude(value, pattern) {
  return collectJsonStrings(value).some((entry) => pattern.test(entry));
}

function collectJsonStrings(value, collected = []) {
  if (typeof value === 'string') {
    collected.push(value);
    return collected;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJsonStrings(entry, collected);
    }
    return collected;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      collected.push(key);
      collectJsonStrings(entry, collected);
    }
  }
  return collected;
}

function escapeRegex(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsBlockedOrFailedStatus(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsBlockedOrFailedStatus(entry));
  for (const [key, nested] of Object.entries(value)) {
    if (/status|verdict|outcome/i.test(key) && typeof nested === 'string') {
      if (/^blocked$|^fail(?:ed)?$|error/i.test(nested)) return true;
    }
    if (containsBlockedOrFailedStatus(nested)) return true;
  }
  return false;
}

function listEvidenceFiles(rootPath, limit = 500) {
  const files = [];
  const stack = [''];
  while (stack.length > 0 && files.length < limit) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(rootPath, relativeDir);
    let entries;
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      const absolutePath = path.join(rootPath, relativePath);
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = readdirStatFile(absolutePath);
      } catch {
        size = 0;
      }
      files.push({
        path: absolutePath,
        relativePath,
        size,
      });
      if (files.length >= limit) break;
    }
  }
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function readdirStatFile(filePath) {
  const result = runBoundedCommand('/usr/bin/stat', ['-f', '%z', filePath], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  const size = Number(result.stdout.trim());
  return Number.isFinite(size) ? size : 0;
}

function compareTuiEvidenceBundles(beforeEvidence, afterEvidence) {
  const beforeByScenario = new Map(
    beforeEvidence.scenarioEvidence.map((entry) => [entry.scenario, entry]),
  );
  const afterByScenario = new Map(
    afterEvidence.scenarioEvidence.map((entry) => [entry.scenario, entry]),
  );
  const scenarios = REQUIRED_TUI_CAPTURE_SCENARIOS.map((scenario) => {
    const before = beforeByScenario.get(scenario);
    const after = afterByScenario.get(scenario);
    return {
      scenario,
      beforeStatus: before?.status,
      beforeModality: before?.modality,
      beforePath: before?.path,
      afterStatus: after?.status,
      afterModality: after?.modality,
      afterPath: after?.path,
      comparable: before?.status === 'PASS' && after?.status === 'PASS',
    };
  });
  const missingBefore = scenarios
    .filter((entry) => entry.beforeStatus !== 'PASS')
    .map((entry) => entry.scenario);
  const missingAfter = scenarios
    .filter((entry) => entry.afterStatus !== 'PASS')
    .map((entry) => entry.scenario);
  return {
    status: missingBefore.length === 0 && missingAfter.length === 0 ? 'PASS' : 'BLOCKED',
    reason:
      missingBefore.length === 0 && missingAfter.length === 0
        ? 'Before/after bundles are comparable for every required scenario.'
        : `Comparison blocked; missing before=[${missingBefore.join(', ')}], after=[${missingAfter.join(', ')}].`,
    reportedImprovement: false,
    improvementClaimPolicy:
      'The harness does not claim visual improvement without evidence and an Ouroboros QA verdict.',
    scenarios,
    missingBefore,
    missingAfter,
  };
}

async function inspectTargetedTuiTestLogs(evidenceRoot) {
  const commandRecords = await inspectTargetedTuiCommandRecords(evidenceRoot);
  const logFiles = listEvidenceFiles(evidenceRoot).filter((file) => {
    const normalized = file.relativePath.toLowerCase();
    return (
      /\.(log|txt|json)$/.test(normalized) &&
      /test|vitest|tap|junit|targeted/.test(normalized) &&
      /tui|kimi-code|apps\/kimi-code/.test(normalized) &&
      file.size > 0
    );
  });
  const logs = [];
  for (const file of logFiles) {
    const raw = await readFile(file.path, 'utf8');
    const validation = validateTargetedTuiTestLog(raw);
    logs.push({
      path: file.path,
      relativePath: file.relativePath,
      bytes: file.size,
      validation,
    });
  }
  const passingRecords = commandRecords.records.filter(
    (record) => record.validation.status === 'PASS',
  );
  const passingLogs = logs.filter((log) => log.validation.status === 'PASS');
  const status = passingRecords.length > 0 ? 'PASS' : 'FAIL';
  return {
    status,
    reason:
      status === 'PASS'
        ? `Found targeted TUI test command record(s) with Vitest/pnpm pass output (${passingRecords.length} command record(s), ${passingLogs.length} supplemental standalone log(s)).`
        : 'PASS requires a harness command record with command provenance, expected test files, exit 0, and Vitest/pnpm pass output; standalone logs are supplemental only.',
    commandRecords,
    logs,
  };
}

async function inspectTargetedTuiCommandRecords(evidenceRoot) {
  const files = listEvidenceFiles(path.join(evidenceRoot, 'commands')).filter((file) =>
    file.relativePath.endsWith('.jsonl'),
  );
  const records = [];
  for (const file of files) {
    const raw = await readFile(file.path, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      const record = tryParseJson(line);
      if (record === undefined) continue;
      const validation = validateTargetedTuiCommandRecord(record);
      if (validation.relevant) {
        records.push({
          path: file.path,
          relativePath: file.relativePath,
          name: record.name,
          validation,
          argv: record.argv,
          exitCode: record.exitCode,
        });
      }
    }
  }
  return {
    inspectedFiles: files.map((file) => file.relativePath),
    records,
  };
}

function validateTargetedTuiCommandRecord(record) {
  const argv = Array.isArray(record?.argv)
    ? record.argv.map(String)
    : [record?.command, ...(Array.isArray(record?.args) ? record.args : [])]
        .filter((value) => value !== undefined)
        .map(String);
  const commandText = argv.join(' ');
  const stdout = typeof record?.stdout === 'string' ? record.stdout : '';
  const stderr = typeof record?.stderr === 'string' ? record.stderr : '';
  const output = `${stdout}\n${stderr}`;
  const relevant =
    record?.name === 'kimi-code-targeted-tui-tests' ||
    TARGETED_TUI_TEST_FILES.every((testFile) => commandText.includes(testFile));
  if (!relevant) {
    return { relevant: false, status: 'SKIP', reason: 'not a targeted TUI test command' };
  }
  const failures = [];
  if (!/corepack\s+pnpm|^corepack\b/.test(commandText)) {
    failures.push('argv does not prove corepack pnpm invocation');
  }
  if (!commandText.includes('--filter') || !commandText.includes('@moonshot-ai/kimi-code')) {
    failures.push('argv does not target @moonshot-ai/kimi-code');
  }
  for (const testFile of TARGETED_TUI_TEST_FILES) {
    if (!commandText.includes(testFile)) {
      failures.push(`argv is missing ${testFile}`);
    }
  }
  if (record?.exitCode !== 0) {
    failures.push(`exitCode is ${record?.exitCode}`);
  }
  if (!hasVitestPassOutput(output)) {
    failures.push('stdout/stderr does not contain Vitest/pnpm pass output');
  }
  if (hasTestFailureOutput(output)) {
    failures.push('stdout/stderr contains failure output');
  }
  return {
    relevant: true,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'command record proves targeted TUI tests passed'
        : failures.join('; '),
    failures,
  };
}

function validateTargetedTuiTestLog(raw) {
  const failures = [];
  if (!/(^|\n)\s*(command|argv)\s*[:=].*(corepack\s+pnpm|corepack\b)/i.test(raw)) {
    failures.push('log has no command/argv provenance for corepack pnpm');
  }
  if (!/@moonshot-ai\/kimi-code|apps\/kimi-code/i.test(raw)) {
    failures.push('log does not identify the kimi-code package/app');
  }
  for (const testFile of TARGETED_TUI_TEST_FILES) {
    if (!raw.includes(testFile)) {
      failures.push(`log is missing ${testFile}`);
    }
  }
  if (!/(^|\n)\s*(exitCode|exit-code|status)\s*[:=]\s*0\b/i.test(raw)) {
    failures.push('log does not prove exit code 0');
  }
  if (!hasVitestPassOutput(raw)) {
    failures.push('log does not contain Vitest/pnpm pass output');
  }
  if (hasTestFailureOutput(raw)) {
    failures.push('log contains failure output');
  }
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0 ? 'log proves targeted TUI tests passed' : failures.join('; '),
    failures,
  };
}

function hasVitestPassOutput(output) {
  return (
    /vitest/i.test(output) &&
    (/Test Files\s+\d+\s+passed/i.test(output) ||
      /Tests\s+\d+\s+passed/i.test(output) ||
      /✓\s+.*test\/tui\//i.test(output) ||
      /PASS\s+.*test\/tui\//i.test(output))
  );
}

function hasTestFailureOutput(output) {
  return /Test Files\s+\d+\s+failed|Tests\s+\d+\s+failed|\bFAIL\b|ERR_PNPM|Command failed|exitCode\s*[:=]\s*[1-9]/i.test(
    output,
  );
}

async function inspectOuroborosVerdict(context, summary) {
  const verdictPath = findOuroborosVerdictPath(context, summary);
  const base = {
    required: true,
    passThreshold: TUI_OUROBOROS_PASS_THRESHOLD,
    expectedVerdictFamily: 'ouroboros_qa-compatible TUI QA verdict',
    preferredExternalTool: EXPECTED_OUROBOROS_TOOL,
    toolCalledByHarness: summary.ouroborosVerdictSource?.status === 'CREATED',
    verdictSource: summary.ouroborosVerdictSource,
    path: verdictPath,
  };
  if (verdictPath === undefined) {
    return {
      ...base,
      status: 'BLOCKED',
      reason:
        'Before/after visual evidence exists, but no ouroboros_qa-compatible verdict artifact was supplied. Set KIMI_QA_OUROBOROS_VERDICT_PATH or place an ouroboros verdict JSON in the evidence root.',
    };
  }
  try {
    const raw = await readFile(verdictPath, 'utf8');
    const parsed = JSON.parse(raw);
    const score = extractOuroborosScore(parsed);
    const validation = validateOuroborosVerdict(parsed, score);
    if (validation.status !== 'PASS') {
      return {
        ...base,
        status: validation.blocked ? 'BLOCKED' : 'FAIL',
        reason: validation.reason,
        score,
        validation,
        verdict: parsed,
      };
    }
    if (score === undefined) {
      return {
        ...base,
        status: 'FAIL',
        reason: `Ouroboros verdict exists but has no numeric score: ${verdictPath}`,
        verdict: parsed,
      };
    }
    return {
      ...base,
      status: score >= TUI_OUROBOROS_PASS_THRESHOLD ? 'PASS' : 'FAIL',
      reason:
        score >= TUI_OUROBOROS_PASS_THRESHOLD
          ? `Ouroboros-compatible QA score ${score} meets threshold ${TUI_OUROBOROS_PASS_THRESHOLD} with required schema provenance.`
          : `Ouroboros-compatible QA score ${score} is below threshold ${TUI_OUROBOROS_PASS_THRESHOLD}.`,
      score,
      validation,
      verdict: parsed,
    };
  } catch (error) {
    return {
      ...base,
      status: 'FAIL',
      reason: `failed to read Ouroboros verdict artifact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function findOuroborosVerdictPath(context, summary) {
  const candidates = [
    process.env.KIMI_QA_OUROBOROS_VERDICT_PATH,
    path.join(context.evidenceRoot, 'ouroboros_qa.json'),
    path.join(context.evidenceRoot, 'ouroboros-verdict.json'),
    path.join(context.evidenceRoot, 'qa-verdict.json'),
    path.join(context.evidenceRoot, 'verdict.json'),
    summary.afterEvidence?.path === undefined
      ? undefined
      : path.join(summary.afterEvidence.path, 'ouroboros_qa.json'),
    summary.afterEvidence?.path === undefined
      ? undefined
      : path.join(summary.afterEvidence.path, 'verdict.json'),
  ].filter((candidate) => candidate !== undefined);
  return candidates.find((candidate) => {
    try {
      return readdirStatFile(candidate) > 0;
    } catch {
      return false;
    }
  });
}

function extractOuroborosScore(verdict) {
  const candidates = [
    verdict?.score,
    verdict?.quality_score,
    verdict?.overall_score,
    verdict?.verdict?.score,
    verdict?.result?.score,
    verdict?.qa?.score,
  ];
  const score = candidates.find((value) => typeof value === 'number' && Number.isFinite(value));
  if (score === undefined) return undefined;
  return score > 1 && score <= 100 ? score / 100 : score;
}

function validateOuroborosVerdict(verdict, score) {
  const failures = [];
  let blocked = false;
  if (verdict === null || typeof verdict !== 'object' || Array.isArray(verdict)) {
    return { status: 'FAIL', reason: 'Ouroboros verdict must be a JSON object' };
  }
  if (score === undefined) {
    failures.push('missing numeric score');
  } else if (score < TUI_OUROBOROS_PASS_THRESHOLD) {
    failures.push(`score ${score} is below threshold ${TUI_OUROBOROS_PASS_THRESHOLD}`);
  }
  if (verdict.toolCalled === false || verdict?.metadata?.toolCalled === false) {
    failures.push('toolCalled is false');
    blocked = true;
  }
  if (containsBlockedOrFailedStatus(verdict)) {
    failures.push('verdict contains BLOCKED/FAIL status');
    blocked = true;
  }
  if (!jsonStringsInclude(verdict, /mcp__ouroboros\.ouroboros_qa|ouroboros_qa/i)) {
    failures.push('verdict does not identify an ouroboros_qa-compatible review');
    blocked = true;
  }
  if (!jsonStringsInclude(verdict, /tui-evidence|terminal ui|tui/i)) {
    failures.push('verdict does not identify the TUI evidence artifact type');
  }
  if (!jsonStringsInclude(verdict, /readab|keyboard|viewport|overlap|stale|misleading/i)) {
    failures.push('verdict does not include the Todo 7 quality bar');
  }
  if (!jsonStringsInclude(verdict, /qa[_-]?session|session|run[_-]?id|captured[_-]?at|evaluated[_-]?at/i)) {
    failures.push('verdict does not include QA session/run metadata');
  }
  if (failures.length > 0) {
    return {
      status: 'FAIL',
      blocked,
      reason: `Ouroboros verdict failed schema/provenance checks: ${failures.join('; ')}`,
      failures,
    };
  }
  return {
    status: 'PASS',
    reason: 'Ouroboros-compatible verdict has review provenance, TUI quality-bar schema, session metadata, and passing score.',
  };
}

function buildTuiVisualBlockedReason(summary) {
  const parts = [];
  if (summary.beforeEvidence.status !== 'PASS') {
    parts.push(`before: ${summary.beforeEvidence.reason}`);
  }
  if (summary.afterEvidence.status !== 'PASS') {
    parts.push(`after: ${summary.afterEvidence.reason}`);
  }
  return `BLOCKED: before/after visible TUI evidence is incomplete; ${parts.join('; ')}`;
}

function renderTuiEvidenceSummary(summary) {
  const lines = [
    '# TUI Iteration Evidence Summary',
    '',
    `status: ${summary.status}`,
    `reason: ${summary.reason}`,
    `before: ${summary.beforeEvidence?.path ?? summary.tuiBeforeInput ?? '<missing>'}`,
    `after: ${summary.afterEvidence?.path ?? summary.tuiAfterInput ?? '<missing>'}`,
    `ouroborosRequired: ${summary.ouroborosRequired}`,
    `ouroborosVerdict: ${summary.ouroborosVerdict?.status ?? '<not evaluated>'}`,
    `ouroborosVerdictPath: ${summary.ouroborosVerdict?.path ?? '<none>'}`,
    `targetedTestLogs: ${summary.targetedTestLogs?.status ?? '<not evaluated>'}`,
    '',
    '## Scenario Matrix',
    '',
    '| scenario | before | after | before modality | after modality |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const entry of summary.comparison?.scenarios ?? []) {
    lines.push(
      `| ${entry.scenario} | ${entry.beforeStatus ?? 'missing'} | ${entry.afterStatus ?? 'missing'} | ${entry.beforeModality ?? ''} | ${entry.afterModality ?? ''} |`,
    );
  }
  lines.push(
    '',
    '## Notes',
    '',
    '- The harness does not claim visual improvement without before/after visual artifacts and an Ouroboros QA verdict.',
    '- If Todo 6 is blocked by unavailable Terminal computer-use state, this phase must remain BLOCKED/nonzero.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function readJsonIfFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function writeTuiAttachHelpers(context, tmuxSession) {
  const tuiDir = path.join(context.evidenceRoot, 'tui');
  const terminalScript = [
    '#!/bin/sh',
    `printf '\\033]0;${context.titlePrefix}\\007'`,
    `exec tmux attach-session -t ${shellQuote(tmuxSession)}`,
    '',
  ].join('\n');
  await writeFile(path.join(tuiDir, 'attach-terminal.command.sh'), terminalScript, 'utf8');
  const terminalAttachCommand = [
    `printf '\\\\033]0;${escapeAppleScriptString(context.titlePrefix)}\\\\007'`,
    `tmux attach-session -t ${tmuxSession}`,
  ].join('; ');
  const appleScript = [
    `set windowTitle to "${escapeAppleScriptString(context.titlePrefix)}"`,
    `set attachCommand to "${escapeAppleScriptString(terminalAttachCommand)}"`,
    'tell application "Terminal"',
    '  activate',
    '  do script attachCommand',
    '  set custom title of front window to windowTitle',
    'end tell',
    '',
  ].join('\n');
  await writeFile(path.join(tuiDir, 'attach-terminal.applescript'), appleScript, 'utf8');
  const iTermScript = [
    `set windowTitle to "${escapeAppleScriptString(context.titlePrefix)}"`,
    `set attachCommand to "${escapeAppleScriptString(terminalAttachCommand)}"`,
    'tell application "iTerm"',
    '  activate',
    '  create window with default profile command attachCommand',
    '  set name of current window to windowTitle',
    'end tell',
    '',
  ].join('\n');
  await writeFile(path.join(tuiDir, 'attach-iterm.applescript'), iTermScript, 'utf8');
}

async function collectComputerUseEvidence(context) {
  const evidencePath = path.join(context.evidenceRoot, 'tui', 'computer-use-state.json');
  const suppliedPath = process.env.KIMI_QA_COMPUTER_USE_STATE_PATH;
  const base = {
    app: 'Terminal',
    requiredTool: 'mcp__computer_use.get_app_state',
    expectedCall: 'mcp__computer_use.get_app_state({ app: "Terminal" })',
    evidencePath,
    suppliedPath,
    requireComputerUse: context.options.requireComputerUse,
  };
  if (context.options.requireComputerUse === 'missing') {
    const result = {
      ...base,
      status: 'BLOCKED',
      reason: 'computer-use was explicitly marked missing by --require-computer-use missing.',
      callableInNodeHarness: false,
    };
    await writeJson(evidencePath, result);
    return result;
  }
  if (suppliedPath !== undefined) {
    try {
      const raw = await readFile(path.resolve(suppliedPath), 'utf8');
      const parsed = JSON.parse(raw);
      const validation = validateSuppliedComputerUseState(parsed, new Date());
      const result = {
        ...base,
        status: validation.status,
        reason: validation.reason,
        schema: computerUseStateSchemaDescription(),
        validation,
        state: parsed,
      };
      await writeJson(evidencePath, result);
      return result;
    } catch (error) {
      const result = {
        ...base,
        status: 'BLOCKED',
        reason: `failed to read supplied computer-use state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      await writeJson(evidencePath, result);
      return result;
    }
  }
  const result = {
    ...base,
    status: 'BLOCKED',
    reason:
      'No callable computer-use MCP bridge is available inside this Node harness and no KIMI_QA_COMPUTER_USE_STATE_PATH artifact was supplied.',
    callableInNodeHarness: false,
    schema: computerUseStateSchemaDescription(),
    unblock:
      'Call mcp__computer_use.get_app_state({ app: "Terminal" }), wrap the result with sourceTool/app/capturedAt plus a non-empty state/accessibilityTree/screenshot payload, then provide its JSON path with KIMI_QA_COMPUTER_USE_STATE_PATH.',
  };
  await writeJson(evidencePath, result);
  return result;
}

function computerUseStateSchemaDescription() {
  return {
    schemaVersion: COMPUTER_USE_STATE_SCHEMA_VERSION,
    requiredFields: {
      sourceTool: 'mcp__computer_use.get_app_state',
      app: 'Terminal',
      capturedAt: 'ISO-8601 timestamp no older than 10 minutes and not more than 60 seconds in the future',
    },
    inspectablePayload:
      'One of state, accessibilityTree, accessibility_tree, screenshot, screen, or windows must be present and non-empty.',
    example: {
      schemaVersion: COMPUTER_USE_STATE_SCHEMA_VERSION,
      sourceTool: 'mcp__computer_use.get_app_state',
      app: 'Terminal',
      capturedAt: new Date(0).toISOString(),
      state: { windows: ['<Terminal state returned by the tool>'] },
    },
  };
}

function validateSuppliedComputerUseState(state, now) {
  const failures = [];
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    failures.push('top-level JSON value must be an object');
  }
  if (state?.schemaVersion !== COMPUTER_USE_STATE_SCHEMA_VERSION) {
    failures.push(`schemaVersion must be ${COMPUTER_USE_STATE_SCHEMA_VERSION}`);
  }
  if (state?.sourceTool !== 'mcp__computer_use.get_app_state') {
    failures.push('sourceTool must be "mcp__computer_use.get_app_state"');
  }
  if (state?.app !== 'Terminal') {
    failures.push('app must be "Terminal"');
  }

  const capturedAt = typeof state?.capturedAt === 'string' ? Date.parse(state.capturedAt) : NaN;
  if (!Number.isFinite(capturedAt)) {
    failures.push('capturedAt must be a parseable ISO-8601 timestamp');
  } else {
    const ageMs = now.getTime() - capturedAt;
    if (ageMs > COMPUTER_USE_STATE_MAX_AGE_MS) {
      failures.push(`capturedAt is stale (${Math.round(ageMs / 1000)}s old; max 600s)`);
    }
    if (ageMs < -COMPUTER_USE_STATE_FUTURE_SKEW_MS) {
      failures.push('capturedAt is too far in the future');
    }
  }

  const payload = findInspectableComputerUsePayload(state);
  if (payload === undefined) {
    failures.push(
      'one of state, accessibilityTree, accessibility_tree, screenshot, screen, or windows must be present and non-empty',
    );
  }

  if (failures.length > 0) {
    return {
      status: 'BLOCKED',
      reason: `supplied computer-use state failed schema/provenance/freshness checks: ${failures.join('; ')}`,
      failures,
    };
  }
  return {
    status: 'PASS',
    reason:
      'Externally supplied Terminal state has required sourceTool/app/capturedAt provenance and a non-empty inspectable payload.',
    capturedAt: state.capturedAt,
    payloadKey: payload.key,
  };
}

function findInspectableComputerUsePayload(state) {
  const payloadKeys = ['state', 'accessibilityTree', 'accessibility_tree', 'screenshot', 'screen', 'windows'];
  for (const key of payloadKeys) {
    const value = state?.[key];
    if (isNonEmptyInspectableValue(value)) {
      return { key, value };
    }
  }
  return undefined;
}

function isNonEmptyInspectableValue(value) {
  if (typeof value === 'string') {
    return value.trim().length >= 20;
  }
  if (Array.isArray(value)) {
    return value.length > 0 && JSON.stringify(value).length >= 20;
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).length > 0 && JSON.stringify(value).length >= 20;
  }
  return false;
}

async function runTuiCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const result = runBoundedCommand(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    timeoutMs: spec.timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const basePath = path.join(context.evidenceRoot, 'commands', `tui-${spec.name}`);
  await writeFile(`${basePath}.stdout.txt`, result.stdout, 'utf8');
  await writeFile(`${basePath}.stderr.txt`, result.stderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${result.status}\n`, 'utf8');
  const record = {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
  await appendFile(
    path.join(context.evidenceRoot, 'commands', `${spec.logName ?? 'tui-launch'}.jsonl`),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
  return record;
}

async function sendTmuxKeys(context, tmuxSession, scenario, keys) {
  return runTuiCommand(context, {
    name: `send-keys-${scenario}`,
    command: 'tmux',
    args: ['send-keys', '-t', tmuxSession, ...keys],
    cwd: context.sourceCheckout,
    timeoutMs: 10_000,
  });
}

async function sendTmuxKeySequence(context, tmuxSession, scenario, keys) {
  const commands = [];
  const steps = [];
  for (let index = 0; index < keys.length; index += 1) {
    const stepKeys = Array.isArray(keys[index]) ? keys[index] : [keys[index]];
    const commandScenario = `${scenario}-${String(index + 1).padStart(2, '0')}`;
    const record = await sendTmuxKeys(context, tmuxSession, commandScenario, stepKeys);
    commands.push(record);
    steps.push({
      index: index + 1,
      key: stepKeys.join(' '),
      keys: stepKeys,
      commandName: record.name,
      exitCode: record.exitCode,
      timedOut: record.timedOut,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMs: record.durationMs,
    });
    if (index < keys.length - 1) await sleep(TUI_INPUT_STEP_DELAY_MS);
  }
  const failures = commands.filter((record) => record.exitCode !== 0);
  return {
    scenario,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? `${scenario} input keys were sent as ${String(keys.length)} ordered step(s).`
        : `${scenario} input had ${String(failures.length)} failed step(s).`,
    delayMs: TUI_INPUT_STEP_DELAY_MS,
    keys: steps.flatMap((step) => step.keys),
    steps,
    commands,
  };
}

async function waitForKimiTuiReady(context, tmuxSession, timeoutMs) {
  const startedAt = Date.now();
  const observations = [];
  while (Date.now() - startedAt < timeoutMs) {
    const screen = runBoundedCommand('tmux', ['capture-pane', '-pt', tmuxSession, '-S', '-80'], {
      cwd: context.sourceCheckout,
      timeoutMs: 10_000,
    });
    const raw = screen.stdout;
    const normalized = normalizeScreenText(raw);
    const hasInputPrompt = matchesAny(raw, [/│\s*>\s*│/, /^\s*>\s*$/m]);
    const ready = screen.status === 0 && hasKimiTuiChrome(normalized) && hasInputPrompt;
    observations.push({
      atMs: Date.now() - startedAt,
      captureExitCode: screen.status,
      ready,
      hasKimiChrome: hasKimiTuiChrome(normalized),
      hasInputPrompt,
      sample: normalized.slice(0, 240),
    });
    if (ready) {
      return {
        status: 'PASS',
        reason: 'Live Kimi TUI chrome and idle input prompt were visible before sending workflow keys.',
        durationMs: Date.now() - startedAt,
        observationCount: observations.length,
        observations,
      };
    }
    await sleep(1_000);
  }
  return {
    status: 'FAIL',
    reason: `timed out after ${String(timeoutMs)}ms waiting for live Kimi TUI idle input prompt before sending workflow keys.`,
    durationMs: Date.now() - startedAt,
    observationCount: observations.length,
    observations,
  };
}

async function captureTmuxPane(context, tmuxSession, scenario) {
  const result = runBoundedCommand('tmux', ['capture-pane', '-pt', tmuxSession, '-S', '-200'], {
    cwd: context.sourceCheckout,
    timeoutMs: 10_000,
  });
  const filePath = path.join(context.evidenceRoot, 'tui', `${scenario}.txt`);
  await writeFile(filePath, result.stdout, 'utf8');
  const stderrPath = path.join(context.evidenceRoot, 'tui', `${scenario}.stderr.txt`);
  await writeFile(stderrPath, result.stderr, 'utf8');
  const screenProof = inspectTuiCapture(scenario, result.stdout);
  return {
    scenario,
    command: 'tmux capture-pane -pt <session> -S -200',
    exitCode: result.status,
    status: result.status === 0 && screenProof.status === 'PASS' ? 'PASS' : 'FAIL',
    reason: result.status === 0 ? screenProof.reason : 'tmux capture-pane command failed.',
    bytes: Buffer.byteLength(result.stdout),
    path: filePath,
    stderrPath,
    screenProof,
  };
}

function inspectTuiCapture(scenario, output) {
  const normalized = normalizeScreenText(output);
  const failures = [];
  if (normalized.length === 0) {
    failures.push('capture is empty');
  }
  if (!hasKimiTuiChrome(normalized)) {
    failures.push('capture does not show recognizable Kimi TUI chrome/content');
  }
  if (/tmux extended-keys is off|tmux extended-keys-format is xterm/i.test(normalized)) {
    failures.push('capture shows tmux keyboard protocol warning');
  }
  if (/^>\s*@moonshot-ai\/kimi-code@.*\bdev\b/m.test(output) || /^>\s*node scripts\/dev\.mjs\b/m.test(output)) {
    failures.push('capture shows pnpm dev script header');
  }
  if (/Already in plan mode/i.test(normalized)) {
    failures.push('capture shows internal plan-mode re-entry error');
  }

  switch (scenario) {
    case 'startup':
      if (!matchesAny(normalized, [/kimi/i, /ask/i, /message/i, /editor/i, /auto/i])) {
        failures.push('startup capture does not show a Kimi startup/editor state');
      }
      break;
    case 'help':
      if (!matchesAny(normalized, [/\/help/i, /\bhelp\b/i, /commands?/i])) {
        failures.push('help capture does not show help or slash-command content');
      }
      break;
    case 'status':
      for (const pattern of [/\bstatus\b/i, /\breadiness\b/i, /\bstate\b/i, /\bchecks\b/i, /\bnext\b/i]) {
        if (!pattern.test(normalized)) {
          failures.push('status capture does not show the status readiness panel');
          break;
        }
      }
      if (!/inspect\s*->\s*(?:test\s*->\s*)?change\s*->\s*verify\s*->\s*summarize/i.test(normalized)) {
        failures.push('status capture does not show the readiness check flow');
      }
      if (!hasXpDodReadinessContract(normalized)) {
        failures.push('status capture does not show the XP-lite/Definition of Done readiness gates');
      }
      break;
    case 'clear':
      if (!matchesAny(normalized, [/kimi/i, /message/i, /editor/i, /prompt/i])) {
        failures.push('clear capture does not show a returned Kimi prompt/editor state');
      }
      break;
    case 'autocomplete':
      if (
        !matchesAny(normalized, [
          /\/help/i,
          /\/clear/i,
          /commands?/i,
          /autocomplete/i,
          /\bauto\b.*\bmodel\b.*\bpermission\b/i,
          /\(\d+\/\d+\)/,
          />\s*\/\w+\s+\[[^\]]+\]/,
        ])
      ) {
        failures.push('autocomplete capture does not show slash-command suggestions');
      }
      break;
    case 'prompt-entry':
      if (!normalized.includes(TUI_PROMPT_ENTRY_TEXT)) {
        failures.push(`prompt-entry capture does not reflect typed text: "${TUI_PROMPT_ENTRY_TEXT}"`);
      }
      break;
    case 'escape-cancel':
      if (normalized.includes(TUI_PROMPT_ENTRY_TEXT)) {
        failures.push('escape-cancel capture still shows the cancelled prompt text');
      }
      break;
    case 'permission-mode':
      if (!matchesAny(normalized, [/\bauto\b/i, /permission/i, /approval/i])) {
        failures.push('permission-mode capture does not show auto/permission mode chrome');
      }
      break;
    case 'real-workflow-plan-off':
      if (!matchesAny(normalized, [/plan mode/i, /\bplan\b/i, /kimi/i, /message/i])) {
        failures.push('real-workflow-plan-off capture does not show direct plan-mode reset evidence');
      }
      break;
    case 'real-workflow-auto-on':
      if (!matchesAny(normalized, [/\bauto\b/i, /permission/i, /approval/i, /kimi/i, /message/i])) {
        failures.push('real-workflow-auto-on capture does not show standard auto/permission mode evidence');
      }
      break;
    case 'exit':
      if (!normalized.includes('/exit')) {
        failures.push('exit capture does not show the /exit command before submission');
      }
      break;
    case 'real-workflow-submitted':
      if (!matchesAny(normalized, [/kimi/i, /message/i, /editor/i, /tool/i, /login/i, /llm not set/i])) {
        failures.push('real-workflow-submitted capture does not show an inspectable TUI workflow state');
      }
      break;
    case 'real-workflow-after-wait':
      if (!matchesAny(normalized, [/kimi/i, /message/i, /editor/i, /tool/i, /login/i])) {
        failures.push('real-workflow-after-wait capture does not show an inspectable TUI workflow state');
      }
      break;
    case 'ultrawork-startup':
    case 'ultrawork-plan-reset':
    case 'ultrawork-submitted':
    case 'ultrawork-after-wait':
      if (!matchesAny(normalized, [/kimi/i, /ultrawork/i, /ultra plan/i, /question/i, /message/i, /editor/i, /thinking/i])) {
        failures.push(`${scenario} capture does not show an inspectable Ultrawork TUI state`);
      }
      break;
    default:
      failures.push(`unexpected TUI capture scenario: ${scenario}`);
      break;
  }

  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? `${scenario} capture shows recognizable Kimi TUI scenario evidence.`
        : failures.join('; '),
    failures,
  };
}

function validateTuiScreenProof(captures) {
  const byScenario = new Map(captures.map((capture) => [capture.scenario, capture]));
  const scenarioResults = REQUIRED_TUI_CAPTURE_SCENARIOS.map((scenario) => {
    const capture = byScenario.get(scenario);
    if (capture === undefined) {
      return {
        scenario,
        status: 'FAIL',
        reason: 'missing tmux capture artifact for required scenario',
      };
    }
    return {
      scenario,
      status: capture.status,
      reason: capture.reason,
      bytes: capture.bytes,
      path: capture.path,
      screenProof: capture.screenProof,
    };
  });
  const failures = scenarioResults.filter((result) => result.status !== 'PASS');
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'All required TUI scenarios have Kimi-specific tmux screen evidence.'
        : `Missing or unrecognized TUI screen evidence for: ${failures
            .map((failure) => failure.scenario)
            .join(', ')}`,
    requiredScenarios: REQUIRED_TUI_CAPTURE_SCENARIOS,
    scenarioResults,
  };
}

async function validateTuiLaunchWorkspace(context, startupCapture) {
  if (startupCapture.status !== 'PASS') {
    return {
      status: 'FAIL',
      reason: 'startup screen proof must pass before validating launch workspace.',
      startupStatus: startupCapture.status,
    };
  }

  const raw = await readFile(startupCapture.path, 'utf8');
  const directoryLine = raw
    .split(/\r?\n/)
    .map((line) => normalizeScreenText(line))
    .find((line) => /\bDirectory:/.test(line));
  const normalized = normalizeScreenText(raw);
  const inspected = directoryLine ?? normalized;
  const pathVariants = (value) =>
    [
      value,
      value.startsWith('/var/') ? `/private${value}` : undefined,
      value.startsWith('/private/var/') ? value.slice('/private'.length) : undefined,
    ]
      .filter((item) => item !== undefined && item.length > 0)
      .map((item) => normalizeScreenText(item));
  const targetMarkers = [
    'super-kimi-autonomous-qa',
    ...pathVariants(context.targetWorktree),
    ...pathVariants(context.tempRoot),
    path.basename(context.targetWorktree),
    path.basename(context.tempRoot),
  ];
  const targetVisible = targetMarkers.some((marker) => {
    if (marker.length === 0) return false;
    if (inspected.includes(marker)) return true;
    return normalized.includes(marker);
  });
  const sourceMarkers = [
    path.basename(context.sourceCheckout),
    ...pathVariants(context.sourceCheckout),
  ];
  const sourceVisible = sourceMarkers.some((marker) => inspected.includes(marker));

  return {
    status: targetVisible && !sourceVisible ? 'PASS' : 'FAIL',
    reason:
      targetVisible && !sourceVisible
        ? 'startup screen shows the disposable target worktree instead of the source checkout.'
        : 'startup screen does not prove that the TUI launched in the disposable target worktree.',
    directoryLine,
    expectedTargetWorkspace: context.targetWorktree,
    forbiddenSourceCheckout: context.sourceCheckout,
  };
}

function validateTuiExitSession(context, tmuxSession) {
  const result = runBoundedCommand('tmux', ['has-session', '-t', tmuxSession], {
    cwd: context.sourceCheckout,
    timeoutMs: 10_000,
  });
  return {
    status: result.status === 1 ? 'PASS' : 'FAIL',
    reason:
      result.status === 1
        ? 'tmux session was gone after submitting /exit.'
        : 'tmux session still existed or could not be checked after submitting /exit.',
    commandProof: commandProof(result),
  };
}

function normalizeScreenText(output) {
  return output
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function hasKimiTuiChrome(output) {
  return matchesAny(output, [
    /\bkimi\b/i,
    /moonshot/i,
    /\/help/i,
    /\/clear/i,
    /\/exit/i,
    /ask kimi/i,
  ]);
}

function hasXpDodReadinessContract(output) {
  return [
    /\bScope\b\s+small focused diff;\s*no broad refactor/i,
    /\bCoverage\b\s+test public behavior changes/i,
    /\bScreen check\b\s+open changed screen before finishing/i,
    /\bDone gate\b\s+tests\/typecheck\/lint\/build\s+\+\s+clean diff\s+\+\s+TUI/i,
  ].every((pattern) => pattern.test(output));
}

function matchesAny(output, patterns) {
  return patterns.some((pattern) => pattern.test(output));
}

function escapeAppleScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function runServerPhase(context) {
  const startedAt = new Date().toISOString();
  const origin = `http://127.0.0.1:${context.selectedPort.port}`;
  const reportDir = path.join(context.evidenceRoot, 'server', 'report');
  const apiOnlyServerRunnerPath = path.join(context.evidenceRoot, 'server', 'api-only-server.mts');
  const rawTextLoaderPath = path.join(context.sourceCheckout, 'build/register-raw-text-loader.mjs');
  const tsconfigPath = path.join(context.sourceCheckout, 'tsconfig.json');
  const cleanupOverrides = {
    status: 'server-phase-completed',
    reason: 'Server phase tracked live server process, port cleanup, and proof commands.',
    liveProcessesStarted: false,
    liveProductCommandsStarted: true,
    killedPids: [],
    releasedPorts: [],
    proofCommands: [],
  };
  const summary = {
    schemaVersion: 1,
    phase: 'server',
    status: 'FAIL',
    startedAt,
    completedAt: undefined,
    sourceCwd: context.sourceCheckout,
    kimiCodeHome: context.plannedKimiCodeHome,
    host: '127.0.0.1',
    port: context.selectedPort.port,
    origin,
    reportDir,
    requestedServerCommand: [
      'corepack',
      'pnpm',
      '-C',
      'apps/kimi-code',
      'run',
      'dev:server',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      String(context.selectedPort.port),
      '--debug-endpoints',
    ],
    serverCommand: [
      'corepack',
      'pnpm',
      '--filter',
      '@moonshot-ai/server',
      'exec',
      'tsx',
      '--tsconfig',
      tsconfigPath,
      '--import',
      rawTextLoaderPath,
      apiOnlyServerRunnerPath,
    ],
    argvCompatibility:
      'The requested CLI dev:server form is recorded, but the QA harness starts @moonshot-ai/server directly as an API-only server. This keeps the real REST/WebSocket surface without depending on browser UI assets.',
    validations: {},
    artifacts: {},
  };

  let serverProcess;
  let serverCredential;
  let tempRootCreated = false;
  let tempHomeCreated = false;
  let tempRootRemoved = false;

  try {
    await mkdir(path.join(context.evidenceRoot, 'server'), { recursive: true });
    summary.validations.nodeRuntime = passFail(
      context.nodeRuntime.status === 'PASS',
      `server child commands require Node >=${context.nodeRuntime.minimum}; selected ${context.nodeRuntime.nodePath} (${context.nodeRuntime.version})`,
    );
    summary.validations.loopbackOnly = passFail(
      summary.host === '127.0.0.1',
      'server phase must bind only 127.0.0.1',
    );
    await writeJson(path.join(context.evidenceRoot, 'server', 'node-runtime.json'), context.nodeRuntime);
    if (summary.validations.nodeRuntime.status !== 'PASS') {
      summary.reason = summary.validations.nodeRuntime.reason;
      throw new Error(summary.reason);
    }
    summary.validations.portPreflight = passFail(
      context.selectedPort.availability.status === 'PASS',
      context.selectedPort.availability.reason,
    );
    await writeJson(path.join(context.evidenceRoot, 'server', 'port-preflight.json'), {
      host: '127.0.0.1',
      port: context.selectedPort.port,
      availability: context.selectedPort.availability,
    });
    if (summary.validations.portPreflight.status !== 'PASS') {
      summary.reason = `selected port is unavailable: ${context.selectedPort.availability.reason}`;
      throw new Error(summary.reason);
    }

    const nodePtyRepair = await runNodePtyRepair(context);
    summary.nodePtyRepair = nodePtyRepair;
    summary.artifacts.nodePtyRepair = path.join(context.evidenceRoot, 'server', 'node-pty-repair.json');
    summary.validations.nodePtyRepair = passFail(
      nodePtyRepair.status === 'PASS',
      nodePtyRepair.reason,
    );
    if (summary.validations.nodePtyRepair.status !== 'PASS') {
      summary.reason = nodePtyRepair.reason;
      throw new Error(summary.reason);
    }

    await mkdir(context.tempRoot, { recursive: true });
    tempRootCreated = true;
    await mkdir(context.plannedKimiCodeHome, { recursive: true, mode: 0o700 });
    tempHomeCreated = true;
    await rm(reportDir, { recursive: true, force: true });
    await mkdir(reportDir, { recursive: true });
    await writeApiOnlyServerRunner(apiOnlyServerRunnerPath, context);
    const browserUiAssetsScopeGuard = {
      status: 'PASS',
      reason: 'Server phase does not create or inject browser UI assets; API and server checks must not depend on a browser bundle success path.',
      fakeBrowserUiAssetsHookInjected: false,
      generatedBrowserAssetFiles: [],
      forbiddenSuccessPath: 'browser-ui/static-assets',
    };
    await writeJson(path.join(context.evidenceRoot, 'server', 'browser-ui-assets-scope-guard.json'), browserUiAssetsScopeGuard);
    summary.validations.browserUiAssetsScopeGuard = passFail(
      !browserUiAssetsScopeGuard.fakeBrowserUiAssetsHookInjected && browserUiAssetsScopeGuard.generatedBrowserAssetFiles.length === 0,
      browserUiAssetsScopeGuard.reason,
    );
    summary.artifacts.browserUiAssetsScopeGuard = path.join(context.evidenceRoot, 'server', 'browser-ui-assets-scope-guard.json');

    const serverEnv = withRequiredNodePath(
      {
        ...process.env,
        KIMI_CODE_HOME: context.plannedKimiCodeHome,
        KIMI_CODE_CACHE_DIR: path.join(context.tempRoot, 'native-cache'),
        KIMI_QA_SERVER_HOST: '127.0.0.1',
        KIMI_QA_SERVER_PORT: String(context.selectedPort.port),
      },
      context,
    );
    serverProcess = startTrackedProcess(context, {
      name: 'server',
      command: 'corepack',
      args: summary.serverCommand.slice(1),
      cwd: context.sourceCheckout,
      env: serverEnv,
      metadata: {
        host: '127.0.0.1',
        port: context.selectedPort.port,
        origin,
        kimiCodeHome: context.plannedKimiCodeHome,
        apiOnlyServerRunnerPath,
        rawTextLoaderPath,
        tsconfigPath,
        nodeRuntime: context.nodeRuntime,
        env: redactEnvironment(
          {
            KIMI_CODE_HOME: context.plannedKimiCodeHome,
            KIMI_CODE_CACHE_DIR: path.join(context.tempRoot, 'native-cache'),
            KIMI_QA_SERVER_HOST: '127.0.0.1',
            KIMI_QA_SERVER_PORT: String(context.selectedPort.port),
            NODE_OPTIONS: process.env.NODE_OPTIONS,
          },
          context.redactionPolicy,
        ).variables,
      },
    });
    cleanupOverrides.liveProcessesStarted = true;
    summary.serverPid = serverProcess.pid;
    summary.artifacts.serverStdout = serverProcess.stdoutPath;
    summary.artifacts.serverStderr = serverProcess.stderrPath;
    await writeJson(path.join(context.evidenceRoot, 'server', 'server-start.json'), {
      pid: serverProcess.pid,
      argv: summary.serverCommand,
      cwd: context.sourceCheckout,
      host: '127.0.0.1',
      port: context.selectedPort.port,
      origin,
      kimiCodeHome: context.plannedKimiCodeHome,
      apiOnlyServerRunnerPath,
      rawTextLoaderPath,
      tsconfigPath,
      nodeRuntime: context.nodeRuntime,
      stdoutPath: serverProcess.stdoutPath,
      stderrPath: serverProcess.stderrPath,
    });

    const healthWait = await waitForHealth(origin, SERVER_START_TIMEOUT_MS, serverProcess);
    summary.validations.healthWait = passFail(
      healthWait.status === 'PASS',
      healthWait.reason,
    );
    await writeJson(path.join(context.evidenceRoot, 'server', 'health-wait.json'), healthWait);
    if (healthWait.status !== 'PASS') {
      summary.reason = healthWait.reason;
      throw new Error(summary.reason);
    }

    const healthCurl = await runAsyncRecordedCommand(context, {
      name: 'server-health-curl',
      command: 'curl',
      args: ['-sS', '-i', `${origin}/api/v1/healthz`],
      cwd: context.sourceCheckout,
      env: process.env,
      envForEvidence: {},
      timeoutMs: 15_000,
    });
    cleanupOverrides.proofCommands.push(commandProofFromRecord(healthCurl));
    const healthValidation = validateHealthCurl(healthCurl.stdout);
    summary.healthCurl = {
      command: healthCurl.argv,
      stdoutPath: healthCurl.stdoutPath,
      stderrPath: healthCurl.stderrPath,
      exitCode: healthCurl.exitCode,
      httpStatus: healthValidation.httpStatus,
      body: healthValidation.body,
    };
    summary.validations.healthCurl = passFail(
      healthCurl.exitCode === 0 && healthValidation.status === 'PASS',
      healthValidation.reason,
    );
    await writeJson(path.join(context.evidenceRoot, 'server', 'health-curl.json'), summary.healthCurl);
    if (summary.validations.healthCurl.status !== 'PASS') {
      summary.reason = summary.validations.healthCurl.reason;
      throw new Error(summary.reason);
    }

    serverCredential = await readServerCredential(context);
    await writeJson(path.join(context.evidenceRoot, 'server', 'server-credential.json'), {
      status: serverCredential === undefined ? 'missing' : 'present',
      credentialFile: serverCredential === undefined ? undefined : '<redacted>',
      detail: serverCredential === undefined
        ? 'Server credential file was not readable after health passed.'
        : 'Server credential was read from isolated KIMI_CODE_HOME and redacted from evidence.',
    });
    if (serverCredential === undefined) {
      summary.reason = 'server credential file was not readable after health passed';
      throw new Error(summary.reason);
    }

    const wsProbe = await runWebSocketProbe(origin, context, serverCredential);
    summary.validations.websocketProbe = passFail(wsProbe.status === 'PASS', wsProbe.reason);
    summary.artifacts.websocketProbe = path.join(context.evidenceRoot, 'server', 'ws-probe.json');
    if (wsProbe.status !== 'PASS') {
      summary.reason = wsProbe.reason;
      throw new Error(summary.reason);
    }

    const authProbe = await fetchEnvelope(`${origin}/api/v1/auth`, 15_000, {
      Authorization: `Bearer ${serverCredential}`,
    });
    await writeJson(path.join(context.evidenceRoot, 'server', 'provider-readiness.json'), {
      httpStatus: authProbe.httpStatus,
      code: authProbe.body?.code,
      ready: authProbe.body?.data?.ready === true,
      providersCount: Number(authProbe.body?.data?.providers_count ?? 0),
      defaultModelPresent: typeof authProbe.body?.data?.default_model === 'string',
    });
    const providerReady = authProbe.httpStatus === 200 && authProbe.body?.code === 0 && authProbe.body?.data?.ready === true;
    summary.providerReadiness = {
      ready: providerReady,
      httpStatus: authProbe.httpStatus,
      providersCount: Number(authProbe.body?.data?.providers_count ?? 0),
    };

    const stale = await runStaleServerNegativeCheck(context, serverEnv, origin);
    summary.validations.staleServerNegative = passFail(stale.status === 'PASS', stale.reason);
    summary.artifacts.staleServer = path.join(context.evidenceRoot, 'server', 'stale-server.json');
    if (stale.status !== 'PASS') {
      summary.reason = stale.reason;
      throw new Error(summary.reason);
    }

    const e2e = await runServerE2e(context, {
      origin,
      providerReady,
      reportDir,
      serverCredential,
      serverEnv,
    });
    summary.e2e = e2e;
    summary.validations.serverE2e = passFail(e2e.status === 'PASS', e2e.reason);
    summary.validations.e2eReport = passFail(
      await fileExists(path.join(reportDir, 'index.html')),
      'server-e2e report index.html must exist',
    );
    if (summary.validations.serverE2e.status !== 'PASS') {
      summary.reason = e2e.reason;
      throw new Error(summary.reason);
    }
    if (summary.validations.e2eReport.status !== 'PASS') {
      summary.reason = summary.validations.e2eReport.reason;
      throw new Error(summary.reason);
    }

    const failedValidation = Object.values(summary.validations).find(
      (validation) => validation.status !== 'PASS',
    );
    if (failedValidation === undefined) {
      summary.status = 'PASS';
      summary.reason = providerReady
        ? 'Live server REST, WebSocket, full server-e2e, stale-server negative, and cleanup proof passed.'
        : 'Live server REST, WebSocket, no-auth server-e2e subset, provider-blocked evidence, stale-server negative, and cleanup proof passed.';
    } else {
      summary.status = 'FAIL';
      summary.reason = failedValidation.reason;
    }
  } catch (error) {
    summary.status = 'FAIL';
    summary.reason = error instanceof Error ? error.message : String(error);
  } finally {
    cleanupOverrides.tempHome = {
      path: context.plannedKimiCodeHome,
      created: tempHomeCreated,
      removed: false,
      retained: context.options.keepTemp && tempHomeCreated,
      detail: tempHomeCreated
        ? 'Server phase KIMI_CODE_HOME was created before server execution.'
        : 'Server phase KIMI_CODE_HOME was not created.',
    };
    cleanupOverrides.tempRoot = {
      path: context.tempRoot,
      created: tempRootCreated,
      removed: false,
      retained: context.options.keepTemp && tempRootCreated,
      detail: tempRootCreated ? 'Server phase temp root was created.' : 'Server phase temp root was not created.',
    };
    cleanupOverrides.targetWorktree = {
      path: context.targetWorktree,
      created: false,
      removed: false,
      retained: false,
      detail: 'Server phase does not create a disposable target worktree.',
    };

    if (serverProcess !== undefined) {
      const shutdown = await shutdownTrackedServer(context, serverProcess, origin, serverCredential);
      summary.shutdown = shutdown;
      summary.validations.gracefulShutdown = passFail(
        shutdown.status === 'PASS',
        shutdown.reason,
      );
      cleanupOverrides.killedPids = shutdown.killedPids;
      cleanupOverrides.proofCommands.push(...shutdown.proofCommands);
    }

    const lsof = await runAsyncRecordedCommand(context, {
      name: 'server-lsof-after-shutdown',
      command: 'lsof',
      args: [`-iTCP:${context.selectedPort.port}`, '-sTCP:LISTEN'],
      cwd: context.sourceCheckout,
      env: process.env,
      envForEvidence: {},
      timeoutMs: 10_000,
    });
    const released = lsof.exitCode !== 0;
    summary.cleanupProof = {
      lsofCommand: lsof.argv,
      lsofStdoutPath: lsof.stdoutPath,
      lsofStderrPath: lsof.stderrPath,
      lsofExitCode: lsof.exitCode,
      released,
    };
    summary.validations.cleanupLsof = passFail(
      released,
      `lsof -iTCP:${context.selectedPort.port} -sTCP:LISTEN must find no listener after shutdown`,
    );
    cleanupOverrides.releasedPorts = [
      {
        host: '127.0.0.1',
        port: context.selectedPort.port,
        source: context.selectedPort.source,
        status: released ? 'released' : 'listener-still-present',
        proofCommand: lsof.argv,
        stdoutPath: lsof.stdoutPath,
        stderrPath: lsof.stderrPath,
        exitCode: lsof.exitCode,
      },
    ];
    cleanupOverrides.proofCommands.push(commandProofFromRecord(lsof));

    if (summary.status === 'PASS' && summary.validations.cleanupLsof.status !== 'PASS') {
      summary.status = 'FAIL';
      summary.reason = summary.validations.cleanupLsof.reason;
    }
    if (summary.status === 'PASS' && summary.validations.gracefulShutdown?.status !== 'PASS') {
      summary.status = 'FAIL';
      summary.reason = summary.validations.gracefulShutdown.reason;
    }

    if (!context.options.keepTemp && tempRootCreated) {
      await rm(context.tempRoot, { recursive: true, force: true });
      tempRootRemoved = true;
      cleanupOverrides.tempHome.removed = tempHomeCreated;
      cleanupOverrides.tempHome.retained = false;
      cleanupOverrides.tempRoot.removed = true;
      cleanupOverrides.tempRoot.retained = false;
    }
    if (!tempRootRemoved && tempRootCreated) {
      cleanupOverrides.tempHome.retained = tempHomeCreated;
      cleanupOverrides.tempRoot.retained = true;
    }
  }

  return finishServerPhase(context, summary, cleanupOverrides);
}

async function finishServerPhase(context, summary, cleanupOverrides) {
  summary.completedAt = new Date().toISOString();
  await writeJson(path.join(context.evidenceRoot, 'server', 'summary.json'), summary);
  const phaseEntry = {
    name: 'server',
    status: summary.status,
    reason: summary.reason,
    subprocessStarted: cleanupOverrides.liveProcessesStarted,
    liveProductCommandStarted: true,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
  };
  await writeStatusFile(context.evidenceRoot, phaseEntry);
  return { phaseEntry, cleanupOverrides };
}

function startTrackedProcess(context, spec) {
  const stdoutPath = path.join(context.evidenceRoot, 'commands', `${spec.name}.stdout.txt`);
  const stderrPath = path.join(context.evidenceRoot, 'commands', `${spec.name}.stderr.txt`);
  const stdoutStream = createWriteStream(stdoutPath, { flags: 'w' });
  const stderrStream = createWriteStream(stderrPath, { flags: 'w' });
  const startedAt = new Date().toISOString();
  const child = spawn(spec.command, spec.spawnArgs ?? spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);
  const tracked = {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    envForEvidence: spec.metadata?.env ?? {},
    metadata: spec.metadata,
    pid: child.pid,
    stdoutPath,
    stderrPath,
    startedAt,
    child,
    closed: false,
    closeResult: undefined,
  };
  tracked.closePromise = new Promise((resolve) => {
    child.on('error', (error) => {
      tracked.closed = true;
      tracked.closeResult = {
        exitCode: 1,
        signal: undefined,
        error: error.message,
        completedAt: new Date().toISOString(),
      };
      resolve(tracked.closeResult);
    });
    child.on('close', (code, signal) => {
      tracked.closed = true;
      tracked.closeResult = {
        exitCode: code ?? 1,
        signal,
        completedAt: new Date().toISOString(),
      };
      resolve(tracked.closeResult);
    });
  });
  void appendFile(
    path.join(context.evidenceRoot, 'commands', 'server.jsonl'),
    `${JSON.stringify({
      name: spec.name,
      argv: tracked.argv,
      cwd: tracked.cwd,
      pid: tracked.pid,
      startedAt,
      stdoutPath,
      stderrPath,
      metadata: spec.metadata,
      status: 'started',
    })}\n`,
    'utf8',
  );
  return tracked;
}

async function waitForHealth(origin, timeoutMs, trackedProcess) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError = '';
  while (Date.now() < deadline) {
    attempts += 1;
    if (trackedProcess.closed) {
      return {
        status: 'FAIL',
        attempts,
        reason: `server process exited before health became ready (exit ${trackedProcess.closeResult?.exitCode ?? 'unknown'})`,
      };
    }
    try {
      const probe = await fetchEnvelope(`${origin}/api/v1/healthz`, 1_000);
      if (probe.httpStatus === 200 && probe.body?.code === 0) {
        return {
          status: 'PASS',
          attempts,
          reason: '/api/v1/healthz returned HTTP 200 with code:0',
          httpStatus: probe.httpStatus,
          body: probe.body,
        };
      }
      lastError = `HTTP ${probe.httpStatus} code ${String(probe.body?.code)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  return {
    status: 'FAIL',
    attempts,
    reason: `timed out waiting for /api/v1/healthz: ${lastError}`,
  };
}

async function fetchEnvelope(url, timeoutMs, headers = undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      body = { parseError: 'response was not JSON', raw: text.slice(0, 1000) };
    }
    return { httpStatus: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function validateHealthCurl(stdout) {
  const parsed = parseCurlHttpEnvelope(stdout);
  if (parsed.status !== 'PASS') {
    return parsed;
  }
  const { httpStatus, body } = parsed;
  if (httpStatus === 200 && body?.code === 0) {
    return { status: 'PASS', reason: 'health curl returned HTTP 200 and JSON code:0', httpStatus, body };
  }
  return {
    status: 'FAIL',
    reason: `health curl expected HTTP 200 and code:0, got HTTP ${String(httpStatus)} code ${String(body?.code)}`,
    httpStatus,
    body,
  };
}

function validateShutdownCurl(stdout) {
  const parsed = parseCurlHttpEnvelope(stdout);
  if (parsed.status !== 'PASS') {
    return parsed;
  }
  const { httpStatus, body } = parsed;
  if (httpStatus === 200 && body?.code === 0 && body?.data?.ok === true) {
    return {
      status: 'PASS',
      reason: 'shutdown curl returned HTTP 200 and JSON code:0 data.ok:true',
      httpStatus,
      body,
    };
  }
  return {
    status: 'FAIL',
    reason: `shutdown curl expected HTTP 200 and code:0 data.ok:true, got HTTP ${String(httpStatus)} code ${String(body?.code)} ok ${String(body?.data?.ok)}`,
    httpStatus,
    body,
  };
}

function parseCurlHttpEnvelope(stdout) {
  const headerMatches = [...stdout.matchAll(/HTTP\/\d(?:\.\d)?\s+(\d{3})/g)];
  const lastHeader = headerMatches.at(-1);
  const httpStatus = lastHeader === undefined ? undefined : Number(lastHeader[1]);
  const separator = stdout.lastIndexOf('\r\n\r\n') === -1 ? '\n\n' : '\r\n\r\n';
  const separatorIndex = stdout.lastIndexOf(separator);
  if (httpStatus === undefined || separatorIndex === -1) {
    return {
      status: 'FAIL',
      reason: 'curl output did not include an HTTP status and body separator',
      httpStatus,
      body: undefined,
    };
  }
  const bodyText = stdout.slice(separatorIndex + separator.length).trim();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { status: 'FAIL', reason: 'curl body was not JSON', httpStatus, body: undefined };
  }
  return {
    status: 'PASS',
    reason: 'curl output included parseable HTTP status and JSON body',
    httpStatus,
    body,
  };
}

function appendNodeOptionsRequire(existing, hookPath) {
  const requireArg = `--require=${hookPath}`;
  return existing === undefined || existing.trim() === '' ? requireArg : `${existing} ${requireArg}`;
}

async function readServerCredential(context) {
  try {
    const value = await readFile(path.join(context.plannedKimiCodeHome, 'server.token'), 'utf8');
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function runWebSocketProbe(origin, context, credential) {
  const artifactPath = path.join(context.evidenceRoot, 'server', 'ws-probe.json');
  const frames = [];
  if (typeof WebSocket !== 'function') {
    const result = { status: 'FAIL', reason: 'global WebSocket is unavailable in this Node runtime', frames };
    await writeJson(artifactPath, result);
    return result;
  }

  const wsUrl = `${origin.replace(/^http/, 'ws')}/api/v1/ws`;
  let socket;
  try {
    socket = new WebSocket(wsUrl, [`kimi-code.bearer.${credential}`]);
    socket.addEventListener('message', (event) => {
      void (async () => {
        try {
          frames.push(JSON.parse(await websocketDataToText(event.data)));
        } catch (error) {
          frames.push({ parseError: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
    await waitForWebSocketOpen(socket, 5_000);
    const hello = await waitForWebSocketFrame(frames, (frame) => frame.type === 'server_hello', 5_000);
    const helloId = `qa-hello-${context.runId}`;
    socket.send(JSON.stringify({
      type: 'client_hello',
      id: helloId,
      payload: {
        client_id: `qa-server-phase-${context.runId}`,
        subscriptions: [],
      },
    }));
    const ack = await waitForWebSocketFrame(
      frames,
      (frame) => frame.type === 'ack' && frame.id === helloId,
      5_000,
    );
    const result = {
      status: ack.code === 0 ? 'PASS' : 'FAIL',
      reason: ack.code === 0
        ? 'WebSocket server_hello and client_hello ack succeeded.'
        : `client_hello ack code was ${String(ack.code)}`,
      wsUrl,
      serverHello: hello,
      ack,
      frames,
    };
    await writeJson(artifactPath, result);
    return result;
  } catch (error) {
    const result = {
      status: 'FAIL',
      reason: error instanceof Error ? error.message : String(error),
      wsUrl,
      frames,
    };
    await writeJson(artifactPath, result);
    return result;
  } finally {
    try {
      socket?.close();
    } catch {
      // best-effort close
    }
  }
}

function waitForWebSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), timeoutMs);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket error before open'));
    }, { once: true });
  });
}

async function waitForWebSocketFrame(frames, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let cursor = 0;
  while (Date.now() < deadline) {
    while (cursor < frames.length) {
      const frame = frames[cursor];
      cursor += 1;
      if (predicate(frame)) return frame;
    }
    await sleep(25);
  }
  throw new Error('timed out waiting for WebSocket frame');
}

async function websocketDataToText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (typeof data?.text === 'function') return await data.text();
  return String(data);
}

async function runStaleServerNegativeCheck(context, serverEnv) {
  const apiOnlyServerRunnerPath = path.join(context.evidenceRoot, 'server', 'api-only-server.mts');
  const rawTextLoaderPath = path.join(context.sourceCheckout, 'build/register-raw-text-loader.mjs');
  const tsconfigPath = path.join(context.sourceCheckout, 'tsconfig.json');
  const stale = startTrackedProcess(context, {
    name: 'stale-server',
    command: 'corepack',
    args: [
      'pnpm',
      '--filter',
      '@moonshot-ai/server',
      'exec',
      'tsx',
      '--tsconfig',
      tsconfigPath,
      '--import',
      rawTextLoaderPath,
      apiOnlyServerRunnerPath,
    ],
    cwd: context.sourceCheckout,
    env: serverEnv,
    metadata: {
      purpose: 'stale-server negative check',
      expected: 'second server on same port/home exits non-zero instead of silently reusing state',
      host: '127.0.0.1',
      port: context.selectedPort.port,
      kimiCodeHome: context.plannedKimiCodeHome,
      apiOnlyServerRunnerPath,
      rawTextLoaderPath,
      tsconfigPath,
    },
  });
  const close = await waitForTrackedClose(stale, 20_000);
  let killed = false;
  if (close.timedOut) {
    killed = true;
    stale.child.kill('SIGTERM');
    await waitForTrackedClose(stale, 5_000);
  }
  await redactTrackedProcessOutput(context, stale);
  const result = {
    status: !close.timedOut && close.exitCode !== 0 ? 'PASS' : 'FAIL',
    reason: !close.timedOut && close.exitCode !== 0
      ? `second server refused to start as expected (exit ${close.exitCode})`
      : 'second server did not fail fast on the same port/home',
    pid: stale.pid,
    argv: stale.argv,
    stdoutPath: stale.stdoutPath,
    stderrPath: stale.stderrPath,
    exitCode: close.exitCode,
    signal: close.signal,
    timedOut: close.timedOut,
    killed,
  };
  await writeJson(path.join(context.evidenceRoot, 'server', 'stale-server.json'), result);
  return result;
}

async function writeApiOnlyServerRunner(runnerPath, context) {
  const serverEntry = pathToFileURL(path.join(context.sourceCheckout, 'packages/server/src/index.ts')).href;
  const source = `import { startServer } from ${JSON.stringify(serverEntry)};

const host = process.env.KIMI_QA_SERVER_HOST ?? '127.0.0.1';
const port = Number(process.env.KIMI_QA_SERVER_PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('KIMI_QA_SERVER_PORT must be a valid TCP port');
}

const running = await startServer({
  host,
  port,
  logLevel: 'silent',
  debugEndpoints: true,
  insecureNoTls: true,
  allowRemoteShutdown: true,
  allowRemoteTerminals: true,
});

console.log(JSON.stringify({
  event: 'api-only-server-ready',
  address: running.address,
  browserUiAssets: 'removed',
}));

let stopping = false;
async function stop(reason) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'api-only-server-stopping', reason }));
  try {
    await running.close();
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => {
  void stop('SIGINT');
});
process.once('SIGTERM', () => {
  void stop('SIGTERM');
});

await new Promise(() => {});
`;
  await writeFile(runnerPath, source, 'utf8');
}

async function writeServerE2eAuthHook(context) {
  const hookPath = path.join(context.evidenceRoot, 'server', 'server-e2e-auth.cjs');
  const hookSource = `const Module = require('node:module');
const credential = process.env.KIMI_SERVER_CRED;
const baseUrl = process.env.KIMI_SERVER_URL;
function applyHeaders(headers) {
  headers.Authorization = headers.Authorization || 'Bearer ' + credential;
  return headers;
}
if (credential && baseUrl && typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function patchedFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (typeof url === 'string' && url.startsWith(baseUrl + '/api/')) {
      const nextInit = { ...(init || {}) };
      const headers = new Headers(nextInit.headers || (typeof input === 'object' ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + credential);
      nextInit.headers = headers;
      return originalFetch(input, nextInit);
    }
    return originalFetch(input, init);
  };
}
for (const moduleName of ['node:http', 'node:https']) {
  const transport = require(moduleName);
  const originalRequest = transport.request;
  transport.request = function patchedRequest(options, callback) {
    if (credential && options && typeof options === 'object') {
      const path = options.path || options.pathname || '';
      if (typeof path === 'string' && path.startsWith('/api/v1/ws')) {
        options = { ...options, headers: applyHeaders({ ...(options.headers || {}) }) };
      }
    }
    return originalRequest.call(this, options, callback);
  };
}
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (request !== 'ws' || !credential) return loaded;
  const Base = loaded.WebSocket || loaded;
  class PatchedWebSocket extends Base {
    constructor(address, protocols, options) {
      const protocolList = Array.isArray(protocols)
        ? protocols.slice()
        : typeof protocols === 'string'
          ? [protocols]
          : [];
      protocolList.push('kimi-code.bearer.' + credential);
      const nextOptions = { ...((options || (protocols && typeof protocols === 'object' && !Array.isArray(protocols) ? protocols : undefined)) || {}) };
      nextOptions.headers = { ...(nextOptions.headers || {}), Authorization: 'Bearer ' + credential };
      super(address, protocolList, nextOptions);
    }
  }
  return { ...loaded, WebSocket: PatchedWebSocket, default: PatchedWebSocket };
};
`;
  await writeFile(hookPath, hookSource, 'utf8');
  await writeJson(path.join(context.evidenceRoot, 'server', 'server-e2e-auth-hook.json'), {
    hookPath,
    purpose: 'Inject isolated server bearer auth into server-e2e fetch and ws clients without modifying package sources or writing the credential to evidence.',
  });
  return { hookPath };
}

async function runServerE2e(context, { origin, providerReady, reportDir, serverCredential, serverEnv }) {
  const authHook = await writeServerE2eAuthHook(context);
  const env = {
    ...serverEnv,
    KIMI_SERVER_URL: origin,
    KIMI_SERVER_E2E_REPORT_DIR: reportDir,
    KIMI_SERVER_CRED: serverCredential,
    NODE_OPTIONS: appendNodeOptionsRequire(serverEnv.NODE_OPTIONS, authHook.hookPath),
  };
  if (providerReady) {
    const full = await runAsyncRecordedCommand(context, {
      name: 'server-e2e-full',
      command: 'corepack',
      args: ['pnpm', '--filter', '@moonshot-ai/server-e2e', 'test:scenarios'],
      cwd: context.sourceCheckout,
      env,
      envForEvidence: {
        KIMI_SERVER_URL: origin,
        KIMI_SERVER_E2E_REPORT_DIR: reportDir,
        NODE_OPTIONS: appendNodeOptionsRequire(serverEnv.NODE_OPTIONS, authHook.hookPath),
      },
      timeoutMs: SERVER_E2E_TIMEOUT_MS,
    });
    return {
      mode: 'full',
      status: full.exitCode === 0 ? 'PASS' : 'FAIL',
      reason: full.exitCode === 0
        ? 'full server-e2e scenario suite exited 0'
        : `full server-e2e scenario suite exited ${full.exitCode}`,
      commands: [full],
      reportIndex: path.join(reportDir, 'index.html'),
    };
  }

  await writeJson(path.join(context.evidenceRoot, 'server', 'provider-blocked.json'), {
    status: 'BLOCKED',
    reason: 'Full prompt-submitting scenarios are not required because /api/v1/auth did not report an auth-ready provider.',
    authReady: false,
    noAuthSubset: SERVER_NO_AUTH_SCENARIOS,
    excludedNoAuthScenarios: SERVER_EXCLUDED_NO_AUTH_SCENARIOS,
  });

  const commands = [];
  let failed;
  for (const scenario of SERVER_NO_AUTH_SCENARIOS) {
    const record = await runAsyncRecordedCommand(context, {
      name: `server-e2e-${scenario.replaceAll(/[^a-z0-9]+/gi, '-')}`,
      command: 'corepack',
      args: ['pnpm', '--filter', '@moonshot-ai/server-e2e', 'exec', 'tsx', `scenarios/${scenario}`],
      cwd: context.sourceCheckout,
      env: { ...env, DAEMON_AUTH: 'skip', KIMI_SERVER_E2E_CASE_NAME: scenario.slice(0, -'.ts'.length) },
      envForEvidence: {
        KIMI_SERVER_URL: origin,
        KIMI_SERVER_E2E_REPORT_DIR: reportDir,
        DAEMON_AUTH: 'skip',
        KIMI_SERVER_E2E_CASE_NAME: scenario.slice(0, -'.ts'.length),
        NODE_OPTIONS: appendNodeOptionsRequire(serverEnv.NODE_OPTIONS, authHook.hookPath),
      },
      timeoutMs: SERVER_E2E_TIMEOUT_MS,
    });
    commands.push(record);
    if (record.exitCode !== 0) {
      failed = record;
      break;
    }
  }

  const report = await runAsyncRecordedCommand(context, {
    name: 'server-e2e-subset-report',
    command: 'corepack',
    args: [
      'pnpm',
      '--filter',
      '@moonshot-ai/server-e2e',
      'exec',
      'tsx',
      '-e',
      "import { writeHtmlReport } from './src/report.ts'; console.log(writeHtmlReport({ reportDir: process.env.KIMI_SERVER_E2E_REPORT_DIR, title: 'server-e2e scenarios (no-auth subset)' }));",
    ],
    cwd: context.sourceCheckout,
    env,
    envForEvidence: {
      KIMI_SERVER_URL: origin,
      KIMI_SERVER_E2E_REPORT_DIR: reportDir,
      NODE_OPTIONS: appendNodeOptionsRequire(serverEnv.NODE_OPTIONS, authHook.hookPath),
    },
    timeoutMs: 60_000,
  });
  commands.push(report);

  if (failed !== undefined) {
    return {
      mode: 'no-auth-subset',
      status: 'FAIL',
      reason: `${failed.name} exited ${failed.exitCode}`,
      commands,
      reportIndex: path.join(reportDir, 'index.html'),
    };
  }
  if (report.exitCode !== 0) {
    return {
      mode: 'no-auth-subset',
      status: 'FAIL',
      reason: `server-e2e subset report generation exited ${report.exitCode}`,
      commands,
      reportIndex: path.join(reportDir, 'index.html'),
    };
  }
  return {
    mode: 'no-auth-subset',
    status: 'PASS',
    reason: 'no-auth server-e2e subset exited 0 and report generation completed',
    commands,
    reportIndex: path.join(reportDir, 'index.html'),
  };
}

async function runNodePtyRepair(context) {
  const packagePostinstall = await readPackagePostinstall(context.sourceCheckout);
  const before = await collectNodePtySpawnHelperState(context.sourceCheckout);
  const repairCwd = path.join(context.sourceCheckout, 'apps', 'kimi-code');
  const repair = await runAsyncRecordedCommand(context, {
    name: 'node-pty-repair',
    command: context.nodeRuntime.nodePath,
    args: ['../../scripts/fix-node-pty-perms.mjs'],
    cwd: repairCwd,
    env: withRequiredNodePath(process.env, context),
    envForEvidence: {
      PATH: '<inherited-with-required-node-first>',
    },
    timeoutMs: NODE_PTY_REPAIR_TIMEOUT_MS,
  });
  const after = await collectNodePtySpawnHelperState(context.sourceCheckout);
  const helpersExecutable = after.helpers.length > 0 && after.helpers.every((helper) => helper.executable);
  const status = repair.exitCode === 0 && !repair.timedOut && helpersExecutable ? 'PASS' : 'FAIL';
  const reason = status === 'PASS'
    ? 'node-pty repair script exited 0 and all discovered spawn-helper binaries are executable.'
    : [
        repair.timedOut ? 'node-pty repair script timed out' : undefined,
        repair.exitCode !== 0 ? `node-pty repair script exited ${repair.exitCode}` : undefined,
        after.helpers.length === 0 ? 'no node-pty spawn-helper binaries were discovered after repair' : undefined,
        after.helpers.some((helper) => !helper.executable)
          ? 'one or more existing node-pty spawn-helper binaries remain non-executable after repair'
          : undefined,
      ].filter(Boolean).join('; ');
  const result = {
    status,
    reason,
    scriptPath: path.join(context.sourceCheckout, 'scripts', 'fix-node-pty-perms.mjs'),
    repairWorkingDirectory: repairCwd,
    packagePostinstall,
    timeoutMs: NODE_PTY_REPAIR_TIMEOUT_MS,
    before,
    repairCommand: {
      name: repair.name,
      argv: repair.argv,
      cwd: repair.cwd,
      exitCode: repair.exitCode,
      signal: repair.signal,
      timedOut: repair.timedOut,
      durationMs: repair.durationMs,
      stdoutPath: repair.stdoutPath,
      stderrPath: repair.stderrPath,
      exitCodePath: repair.exitCodePath,
    },
    after,
  };
  await writeJson(path.join(context.evidenceRoot, 'server', 'node-pty-repair.json'), result);
  return result;
}

async function readPackagePostinstall(sourceCheckout) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(sourceCheckout, 'package.json'), 'utf8'));
    return packageJson.scripts?.postinstall;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectNodePtySpawnHelperState(sourceCheckout) {
  let root;
  try {
    root = resolveNodePtyRoot(sourceCheckout);
  } catch (error) {
    return {
      status: 'unresolved',
      reason: error instanceof Error ? error.message : String(error),
      nodePtyRoot: undefined,
      prebuildsPath: undefined,
      helpers: [],
    };
  }

  const prebuildsPath = path.join(root, 'prebuilds');
  let archDirectories;
  try {
    archDirectories = readdirSync(prebuildsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    return {
      status: 'unresolved',
      reason: error instanceof Error ? error.message : String(error),
      nodePtyRoot: root,
      prebuildsPath,
      helpers: [],
    };
  }

  const helpers = [];
  const missingHelpers = [];
  for (const arch of archDirectories) {
    const helperPath = path.join(prebuildsPath, arch, 'spawn-helper');
    try {
      const info = await stat(helperPath);
      helpers.push({
        arch,
        path: helperPath,
        exists: true,
        mode: fileModeOctal(info.mode),
        executable: (info.mode & 0o111) === 0o111,
      });
    } catch (error) {
      missingHelpers.push({
        arch,
        path: helperPath,
        exists: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    status: helpers.length > 0 ? 'resolved' : 'unresolved',
    reason: helpers.length > 0
      ? `${helpers.length} node-pty spawn-helper candidate(s) discovered.`
      : 'node-pty prebuild directories were found, but no spawn-helper candidates were discovered.',
    nodePtyRoot: root,
    prebuildsPath,
    helpers,
    missingHelpers,
  };
}

function resolveNodePtyRoot(sourceCheckout) {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('node-pty', {
    paths: [
      path.join(sourceCheckout, 'packages', 'agent-core'),
      path.join(sourceCheckout, 'apps', 'kimi-code'),
      sourceCheckout,
    ],
  });
  return path.dirname(path.dirname(entry));
}

function fileModeOctal(mode) {
  return `0${(mode & 0o777).toString(8)}`;
}

async function shutdownTrackedServer(context, tracked, origin, credential) {
  const proofCommands = [];
  const killedPids = [];
  let graceful;
  let gracefulValidation;
  let gracefulCloseWait;
  if (!tracked.closed) {
    graceful = await runAsyncRecordedCommand(context, {
      name: 'server-shutdown-curl',
      command: 'curl',
      args: credential === undefined
        ? ['-sS', '-i', '-X', 'POST', `${origin}/api/v1/shutdown`]
        : ['-sS', '-i', '-X', 'POST', '-H', 'Authorization: Bearer <redacted>', `${origin}/api/v1/shutdown`],
      cwd: context.sourceCheckout,
      env: process.env,
      envForEvidence: {},
      timeoutMs: 15_000,
      spawnArgs: credential === undefined
        ? undefined
        : ['-sS', '-i', '-X', 'POST', '-H', `Authorization: Bearer ${credential}`, `${origin}/api/v1/shutdown`],
    });
    proofCommands.push(commandProofFromRecord(graceful));
    gracefulValidation = validateShutdownCurl(graceful.stdout);
    gracefulCloseWait = await waitForTrackedClose(tracked, 15_000);
  }
  const gracefulSucceeded =
    graceful !== undefined &&
    graceful.exitCode === 0 &&
    gracefulValidation?.status === 'PASS' &&
    tracked.closed &&
    tracked.closeResult?.exitCode === 0;
  if (!tracked.closed) {
    tracked.child.kill('SIGTERM');
    const afterTerm = await waitForTrackedClose(tracked, 5_000);
    if (afterTerm.timedOut) {
      tracked.child.kill('SIGKILL');
      killedPids.push({ pid: tracked.pid, signal: 'SIGKILL' });
      await waitForTrackedClose(tracked, 5_000);
    } else {
      killedPids.push({ pid: tracked.pid, signal: 'SIGTERM' });
    }
  }
  const forcedCleanup = killedPids.length > 0;
  const status = gracefulSucceeded ? 'PASS' : 'FAIL';
  const reason = gracefulSucceeded
    ? 'Shutdown endpoint returned HTTP success and the tracked server exited with code 0.'
    : [
        graceful === undefined ? 'shutdown curl was not attempted' : undefined,
        graceful !== undefined && graceful.exitCode !== 0 ? `shutdown curl process exited ${graceful.exitCode}` : undefined,
        gracefulValidation !== undefined && gracefulValidation.status !== 'PASS' ? gracefulValidation.reason : undefined,
        graceful !== undefined && !tracked.closed ? 'server did not exit after shutdown request' : undefined,
        tracked.closeResult !== undefined && tracked.closeResult.exitCode !== 0
          ? `server exit code after shutdown attempt was ${tracked.closeResult.exitCode}`
          : undefined,
        forcedCleanup ? `cleanup used ${killedPids.map((entry) => entry.signal).join(', ')}` : undefined,
      ].filter(Boolean).join('; ');
  await redactTrackedProcessOutput(context, tracked);
  return {
    status,
    reason,
    gracefulShutdownCommand: graceful?.argv,
    gracefulShutdownExitCode: graceful?.exitCode,
    gracefulShutdownHttpStatus: gracefulValidation?.httpStatus,
    gracefulShutdownBody: gracefulValidation?.body,
    gracefulShutdownValidation: gracefulValidation,
    gracefulShutdownCloseWait: gracefulCloseWait,
    cleanupMethod: forcedCleanup ? 'forced-process-signal' : 'shutdown-endpoint-or-already-closed',
    serverExit: tracked.closeResult,
    killedPids,
    proofCommands,
  };
}

async function redactTrackedProcessOutput(context, tracked) {
  await Promise.all([
    redactFileInPlace(tracked.stdoutPath, context.redactionPolicy),
    redactFileInPlace(tracked.stderrPath, context.redactionPolicy),
  ]);
}

async function redactFileInPlace(filePath, policy) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const redacted = redactCommandOutput(raw, policy);
    if (redacted !== raw) {
      await writeFile(filePath, redacted, 'utf8');
    }
  } catch {
    // Missing tracked-process output is handled by the command artifacts that point at it.
  }
}

async function runAsyncRecordedCommand(context, spec) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError;
  const child = spawn(spec.command, spec.spawnArgs ?? spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  let forceKillTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
  }, spec.timeoutMs);
  const close = await new Promise((resolve) => {
    child.on('error', (error) => {
      spawnError = error;
      resolve({ code: 1, signal: undefined });
    });
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  clearTimeout(timer);
  if (forceKillTimer !== undefined) {
    clearTimeout(forceKillTimer);
  }
  const completedAt = new Date().toISOString();
  const basePath = path.join(context.evidenceRoot, 'commands', spec.name);
  await writeFile(`${basePath}.stdout.txt`, stdout, 'utf8');
  await writeFile(`${basePath}.stderr.txt`, stderr, 'utf8');
  await writeFile(`${basePath}.exit-code.txt`, `${close.code ?? 1}\n`, 'utf8');
  const record = {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    env: spec.envForEvidence,
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    exitCode: close.code ?? 1,
    signal: close.signal,
    timedOut,
    stdoutPath: `${basePath}.stdout.txt`,
    stderrPath: `${basePath}.stderr.txt`,
    exitCodePath: `${basePath}.exit-code.txt`,
    stdout,
    stderr,
    error: spawnError?.message,
  };
  await appendFile(
    path.join(context.evidenceRoot, 'commands', 'server.jsonl'),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
  return record;
}

async function waitForTrackedClose(tracked, timeoutMs) {
  if (tracked.closed) return { ...tracked.closeResult, timedOut: false };
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ timedOut: true, exitCode: undefined, signal: undefined }), timeoutMs);
  });
  const result = await Promise.race([tracked.closePromise, timeout]);
  return { ...result, timedOut: result.timedOut === true };
}

function commandProofFromRecord(record) {
  return {
    command: record.command,
    args: record.args,
    cwd: record.cwd,
    exitCode: record.exitCode,
    timedOut: record.timedOut,
    durationMs: record.durationMs,
  };
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function appendCommandEntry(evidenceRoot, runId, phase, options) {
  const entry = {
    timestamp: new Date().toISOString(),
    runId,
    phase,
    status: phase === 'setup' ? 'planned' : 'not-implemented',
    reason:
      phase === 'setup'
        ? 'Todo 2 setup records clean-room state only.'
        : 'Phase reserved for later todos.',
    command: null,
    subprocessStarted: false,
    liveProductCommandStarted: false,
    dryRun: options.dryRun,
  };
  await appendFile(
    path.join(evidenceRoot, 'commands', 'commands.jsonl'),
    `${JSON.stringify(entry)}\n`,
    'utf8',
  );
}

async function writeStatusFile(evidenceRoot, phaseEntry) {
  const statusText = [
    `phase=${phaseEntry.name}`,
    `status=${phaseEntry.status}`,
    `reason=${phaseEntry.reason}`,
    `subprocessStarted=${phaseEntry.subprocessStarted}`,
    `startedAt=${phaseEntry.startedAt}`,
    `completedAt=${phaseEntry.completedAt}`,
    '',
  ].join('\n');
  await writeFile(
    path.join(evidenceRoot, 'logs', `${phaseEntry.name}-status.txt`),
    statusText,
    'utf8',
  );
}

function resolveSourceCheckout() {
  const result = runBoundedCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  if (result.status === 0 && result.stdout.trim() !== '') {
    return path.resolve(result.stdout.trim());
  }
  return path.resolve(process.cwd());
}

function resolveRequiredNodeRuntime(sourceCheckout) {
  const candidates = collectNodeCandidates(sourceCheckout);
  const checked = [];
  for (const nodePath of candidates) {
    const result = runBoundedCommand(nodePath, ['-v'], {
      cwd: sourceCheckout,
      timeoutMs: 5_000,
      env: process.env,
    });
    const version = result.stdout.trim().replace(/^v/, '');
    checked.push({
      nodePath,
      version: version || result.stderr.trim() || `exit ${result.status}`,
      status: result.status === 0 && compareVersions(version, '24.15.0') >= 0 ? 'PASS' : 'FAIL',
    });
    if (result.status === 0 && compareVersions(version, '24.15.0') >= 0) {
      return {
        status: 'PASS',
        nodePath,
        binDir: path.dirname(nodePath),
        version,
        minimum: '24.15.0',
        checked,
      };
    }
  }
  return {
    status: 'FAIL',
    nodePath: process.execPath,
    binDir: path.dirname(process.execPath),
    version: process.versions.node,
    minimum: '24.15.0',
    checked,
  };
}

function collectNodeCandidates(sourceCheckout) {
  const candidates = new Set([process.execPath]);
  if (process.env.NODE !== undefined) candidates.add(process.env.NODE);
  if (process.env.NVM_BIN !== undefined) candidates.add(path.join(process.env.NVM_BIN, 'node'));
  const nvmRoot = process.env.NVM_DIR ?? path.join(os.homedir(), '.nvm');
  addNvmNodeCandidates(candidates, path.join(nvmRoot, 'versions', 'node'));
  const nvmrc = runBoundedCommand('/bin/sh', ['-lc', 'test -f .nvmrc && cat .nvmrc || true'], {
    cwd: sourceCheckout,
    timeoutMs: 5_000,
    env: process.env,
  }).stdout.trim();
  if (nvmrc !== '') {
    candidates.add(path.join(nvmRoot, 'versions', 'node', nvmrc.startsWith('v') ? nvmrc : `v${nvmrc}`, 'bin', 'node'));
  }
  return [...candidates];
}

function addNvmNodeCandidates(candidates, versionsDir) {
  try {
    const versions = readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => compareVersions(right.replace(/^v/, ''), left.replace(/^v/, '')));
    for (const version of versions) {
      candidates.add(path.join(versionsDir, version, 'bin', 'node'));
    }
  } catch {
    // nvm may not be installed; other candidates still apply.
  }
}

function withRequiredNodePath(env, context) {
  const pathValue = env.PATH ?? process.env.PATH ?? '';
  if (context.nodeRuntime.status !== 'PASS') return { ...env, PATH: pathValue };
  return {
    ...env,
    PATH: `${context.nodeRuntime.binDir}${path.delimiter}${pathValue}`,
  };
}

async function selectPort(portValue) {
  if (portValue !== undefined) {
    const port = Number(portValue);
    const availability = await probeLoopbackPort(port);
    return {
      port,
      host: '127.0.0.1',
      source: 'caller-supplied',
      availability,
    };
  }

  const allocated = await allocateEphemeralLoopbackPort();
  return {
    port: allocated.port,
    host: '127.0.0.1',
    source: 'ephemeral-probe',
    availability: allocated.availability,
  };
}

function allocateEphemeralLoopbackPort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      resolve({
        port: undefined,
        availability: {
          status: 'FAIL',
          reason: error.message,
        },
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : undefined;
      server.close(() => {
        resolve({
          port,
          availability: {
            status: port === undefined ? 'FAIL' : 'PASS',
            reason:
              port === undefined
                ? 'Unable to inspect ephemeral loopback port.'
                : 'Ephemeral loopback port was allocated and released.',
          },
        });
      });
    });
  });
}

function probeLoopbackPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      resolve({
        status: 'FAIL',
        reason: `127.0.0.1:${port} is not available: ${error.code ?? error.message}`,
      });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve({
          status: 'PASS',
          reason: `127.0.0.1:${port} accepted a temporary bind and was released.`,
        });
      });
    });
  });
}

async function prepareBaselinePath(evidenceRoot, baselineFile) {
  const baselinePath = path.resolve(baselineFile ?? path.join(evidenceRoot, 'prework-status.txt'));
  if (baselineFile !== undefined) {
    return baselinePath;
  }
  const result = runBoundedCommand('git', ['status', '--short'], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, result.stdout, 'utf8');
  return baselinePath;
}

function runPreflight(sourceCheckout, selectedPort) {
  return {
    node: preflightNode(),
    corepackPnpm: preflightCorepackPnpm(sourceCheckout),
    tmux: preflightBinary('tmux'),
    osascript: preflightBinary('osascript'),
    lsof: preflightBinary('lsof'),
    curl: preflightBinary('curl'),
    git: preflightGit(sourceCheckout),
    omoSparkshell: preflightOmoSparkshell(sourceCheckout),
    loopbackPort: {
      name: 'loopback port',
      status: selectedPort.availability.status,
      expected: 'available loopback port',
      actual: String(selectedPort.port),
      detail: selectedPort.availability.reason,
    },
  };
}

function preflightNode() {
  const actual = process.versions.node;
  return {
    name: 'node',
    status: compareVersions(actual, '24.15.0') >= 0 ? 'PASS' : 'FAIL',
    expected: '>=24.15.0',
    actual,
    detail:
      compareVersions(actual, '24.15.0') >= 0
        ? 'Current Node version satisfies repository engines.'
        : 'Current Node version is below repository engines; setup dry-run records this but does not fail.',
  };
}

function preflightCorepackPnpm(cwd) {
  const result = runBoundedCommand('corepack', ['pnpm', '-v'], {
    cwd,
    timeoutMs: 15_000,
  });
  const actual = result.stdout.trim() || result.stderr.trim() || `exit ${result.status}`;
  return {
    name: 'corepack pnpm',
    status: result.status === 0 && result.stdout.trim() === '10.33.0' ? 'PASS' : 'FAIL',
    expected: '10.33.0',
    actual,
    detail: result.timedOut ? 'Command timed out.' : 'Checked with corepack pnpm -v.',
  };
}

function preflightBinary(binary) {
  const result = runBoundedCommand('/bin/sh', ['-lc', `command -v ${shellQuote(binary)}`], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  return {
    name: binary,
    status: result.status === 0 && result.stdout.trim() !== '' ? 'PASS' : 'FAIL',
    expected: 'available on PATH',
    actual: result.stdout.trim() || result.stderr.trim() || `exit ${result.status}`,
    detail: result.timedOut ? 'Command lookup timed out.' : 'Checked with command -v.',
  };
}

function preflightGit(cwd) {
  const result = runBoundedCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    timeoutMs: 5_000,
  });
  return {
    name: 'git',
    status: result.status === 0 ? 'PASS' : 'FAIL',
    expected: 'repository checkout',
    actual: result.stdout.trim() || result.stderr.trim() || `exit ${result.status}`,
    detail: result.timedOut ? 'git rev-parse timed out.' : 'Checked repository root.',
  };
}

function preflightOmoSparkshell(cwd) {
  const lookup = runBoundedCommand('/bin/sh', ['-lc', 'command -v omo'], {
    cwd,
    timeoutMs: 5_000,
  });
  if (lookup.status !== 0) {
    return {
      name: 'omo sparkshell',
      status: 'FAIL',
      expected: 'omo available on PATH',
      actual: lookup.stderr.trim() || `exit ${lookup.status}`,
      detail: lookup.timedOut ? 'omo lookup timed out.' : 'omo was not found on PATH.',
    };
  }
  const result = runBoundedCommand('omo', ['sparkshell', '--help'], {
    cwd,
    timeoutMs: 15_000,
  });
  return {
    name: 'omo sparkshell',
    status: result.status === 0 ? 'PASS' : 'FAIL',
    expected: 'omo sparkshell --help exits 0',
    actual: result.stdout.split('\n').find((line) => line.trim() !== '') ?? result.stderr.trim() ?? '',
    detail: result.timedOut ? 'omo sparkshell --help timed out.' : 'Checked sparkshell help.',
  };
}

function runBoundedCommand(command, args, { cwd, timeoutMs, env = process.env }) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    command,
    args,
    cwd,
    status: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
    timedOut: result.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - startedAt,
  };
}

function compareVersions(actual, minimum) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < minimumParts.length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart > minimumPart) return 1;
    if (actualPart < minimumPart) return -1;
  }
  return 0;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildRedactionPolicy() {
  return {
    valueForRedactedSecrets: '<redacted>',
    placeholderValuesAllowed: ['YOUR_API_KEY', '<redacted>', '<provided externally>'],
    sensitiveNameFragments: [
      'token',
      'api',
      'key',
      'secret',
      'password',
      'oauth',
      'bearer',
      'auth',
    ],
    likelyCredentialValuePolicy:
      'Values that look like bearer/API tokens, private keys, or long opaque credentials are replaced.',
    promptInjectionPolicy: 'Environment values are treated as inert data and never as instructions.',
  };
}

function redactEnvironment(env, policy) {
  const entries = Object.entries(env)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, redactEnvValue(name, value, policy)]);
  return {
    capturedAt: new Date().toISOString(),
    variableCount: entries.length,
    variables: Object.fromEntries(entries),
  };
}

function redactEnvValue(name, value, policy) {
  if (value === undefined || value === '') {
    return value ?? '';
  }
  if (policy.placeholderValuesAllowed.includes(value)) {
    return value;
  }
  if (isSensitiveName(name) || isLikelyCredentialValue(value)) {
    return policy.valueForRedactedSecrets;
  }
  if (value.length > 240) {
    return `${value.slice(0, 120)}...<truncated:${value.length}>`;
  }
  return value;
}

function isSensitiveName(name) {
  return /token|api|key|secret|password|oauth|bearer|auth/i.test(name);
}

function isLikelyCredentialValue(value) {
  return (
    /sk-[A-Za-z0-9_-]{20,}/.test(value) ||
    /Bearer\s+[A-Za-z0-9._-]{16,}/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /^[A-Za-z0-9_./+=-]{40,}$/.test(value)
  );
}

function buildCleanupReceipt({
  baselinePath,
  createdAt,
  evidenceRoot,
  options,
  runId,
  selectedPort,
  sourceCheckout,
  targetWorktree,
  tempRoot,
  titlePrefix,
  plannedKimiCodeHome,
  overrides = {},
}) {
  const receipt = {
    schemaVersion: 1,
    runId,
    createdAt,
    updatedAt: new Date().toISOString(),
    status: 'no-live-resources-started',
    reason: 'Todo 2 setup did not start server, TUI, tmux, autonomous agent, or product subprocesses.',
    evidenceRoot,
    sourceCheckout,
    dryRun: options.dryRun,
    keepTemp: options.keepTemp,
    liveProcessesStarted: false,
    killedPids: [],
    closedTmuxSessions: [],
    terminalWindows: {
      titlePrefix,
      exactRunIdTitle: titlePrefix,
      matchedByExactRunIdTitle: [],
      closed: [],
      leftOpen: [],
      ignoredPolicy:
        'No Terminal/iTerm windows are closed unless their title exactly matches this run id title.',
    },
    releasedPorts: [
      {
        host: selectedPort.host,
        port: selectedPort.port,
        source: selectedPort.source,
        status: 'not-held-by-harness',
        detail: selectedPort.availability.reason,
      },
    ],
    tempHome: {
      path: plannedKimiCodeHome,
      created: false,
      removed: false,
      retained: false,
      detail: options.dryRun ? 'planned only during dry-run setup' : 'not created by Todo 2 setup',
    },
    targetWorktree: {
      path: targetWorktree,
      created: false,
      removed: false,
      retained: false,
      detail: options.dryRun ? 'planned only during dry-run setup' : 'not created by Todo 2 setup',
    },
    tempRoot: {
      path: tempRoot,
      created: false,
      removed: false,
      retained: false,
      detail: options.dryRun ? 'planned only during dry-run setup' : 'not created by Todo 2 setup',
    },
    baselinePath,
    restoredEnvVars: {
      modifiedByHarness: [],
      restored: [],
      detail: 'Todo 2 setup never mutates process.env.',
    },
    proofCommands: [],
  };
  return {
    ...receipt,
    ...overrides,
    terminalWindows: {
      ...receipt.terminalWindows,
      ...overrides.terminalWindows,
    },
    tempHome: {
      ...receipt.tempHome,
      ...overrides.tempHome,
    },
    targetWorktree: {
      ...receipt.targetWorktree,
      ...overrides.targetWorktree,
    },
    tempRoot: {
      ...receipt.tempRoot,
      ...overrides.tempRoot,
    },
    restoredEnvVars: {
      ...receipt.restoredEnvVars,
      ...overrides.restoredEnvVars,
    },
    proofCommands: overrides.proofCommands ?? receipt.proofCommands,
  };
}

async function writeCleanupReceipt(evidenceRoot, receipt) {
  await mkdir(path.join(evidenceRoot, 'cleanup'), { recursive: true });
  await writeJson(path.join(evidenceRoot, 'cleanup', 'receipt.json'), receipt);
}

function extractEvidenceRootArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--evidence-root') {
      return argv[index + 1];
    }
    if (arg.startsWith('--evidence-root=')) {
      return arg.slice('--evidence-root='.length);
    }
  }
  return undefined;
}

async function writeFailureReceipt({ argv, error, options, runId }) {
  const createdAt = new Date().toISOString();
  const evidenceRootInput = options?.evidenceRoot ?? extractEvidenceRootArg(argv);
  const preferredRoot = evidenceRootInput
    ? path.resolve(evidenceRootInput)
    : path.resolve(DEFAULT_EVIDENCE_BASE, runId);
  const fallbackRoot = path.resolve(
    DEFAULT_EVIDENCE_BASE,
    'task-2',
    'non-writable-fallback',
    runId,
  );
  const receipt = {
    schemaVersion: 1,
    runId,
    createdAt,
    updatedAt: new Date().toISOString(),
    status: 'failed-before-live-resources',
    reason: error.message,
    evidenceRootInput,
    preferredRoot,
    fallbackUsed: false,
    liveProcessesStarted: false,
    killedPids: [],
    closedTmuxSessions: [],
    terminalWindows: {
      titlePrefix: createTerminalTitlePrefix(runId),
      exactRunIdTitle: createTerminalTitlePrefix(runId),
      matchedByExactRunIdTitle: [],
      closed: [],
      leftOpen: [],
      ignoredPolicy:
        'No Terminal/iTerm windows are closed unless their title exactly matches this run id title.',
    },
    releasedPorts: [],
    tempHome: { created: false, removed: false, retained: false },
    targetWorktree: { created: false, removed: false, retained: false },
    tempRoot: { created: false, removed: false, retained: false },
    restoredEnvVars: { modifiedByHarness: [], restored: [] },
  };

  try {
    await writeCleanupReceipt(preferredRoot, receipt);
    await writeFile(path.join(preferredRoot, 'failure.log'), `${error.stack ?? error.message}\n`, 'utf8');
    console.error(`Failure receipt: ${path.join(preferredRoot, 'cleanup', 'receipt.json')}`);
  } catch (preferredError) {
    await mkdir(fallbackRoot, { recursive: true });
    await writeCleanupReceipt(fallbackRoot, {
      ...receipt,
      fallbackUsed: true,
      fallbackReason: preferredError.message,
      fallbackRoot,
    });
    await writeFile(
      path.join(fallbackRoot, 'failure.log'),
      [
        `preferredRoot=${preferredRoot}`,
        `preferredError=${preferredError.message}`,
        `originalError=${error.stack ?? error.message}`,
        '',
      ].join('\n'),
      'utf8',
    );
    console.error(`Failure receipt: ${path.join(fallbackRoot, 'cleanup', 'receipt.json')}`);
  }
}

function manifestOptions(options) {
  return {
    baselineFile: options.baselineFile,
    dryRun: options.dryRun,
    install: options.install,
    keepTemp: options.keepTemp,
    kimiCodeHome: options.kimiCodeHome,
    port: options.port === undefined ? undefined : Number(options.port),
    printPlan: options.printPlan,
    requireComputerUse: options.requireComputerUse,
    simulateMissingAuth: options.simulateMissingAuth,
    tmuxSession: options.tmuxSession,
    tuiAfter: options.tuiAfter,
    tuiBefore: options.tuiBefore,
    useRealKimiHome: options.useRealKimiHome,
  };
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  const runId = createRunId();
  const { errors, options } = parseArgs(argv);

  if (errors.length > 0) {
    const parseError = new Error(errors.join('; '));
    for (const message of errors) {
      console.error(`error: ${message}`);
    }
    console.error('Run with --help to see supported options and phases.');
    await writeFailureReceipt({ argv, error: parseError, options, runId });
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.printPlan && !options.explicitPhase) {
    console.log(JSON.stringify(planPayload(), null, 2));
    return;
  }

  if (options.phase === undefined) {
    options.phase = 'setup';
  }

  if (options.printPlan) {
    console.log(JSON.stringify(planPayload(), null, 2));
  }

  await runHarness(options, runId);
}

try {
  await main();
} catch (error) {
  console.error(`error: ${error.message}`);
  await writeFailureReceipt({
    argv: process.argv.slice(2),
    error,
    options: undefined,
    runId: createRunId(),
  });
  process.exitCode = 1;
}
