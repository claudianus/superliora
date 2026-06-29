#!/usr/bin/env node
/* eslint-disable no-console */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_CRITERIA_PATH = '.omo/bench/sota-criteria.json';
const DEFAULT_OUTPUT_BASE = '.omo/evidence/kimi-agent-sota-gate';
const DEFAULT_EVIDENCE_ROOT = '.omo/evidence';
const SOTA_SUMMARY_FILENAME = 'sota-gate-summary.json';
const AUTO_BASELINE_SCAN_LIMIT = 20_000;
const REQUIRED_TUI_SCENARIOS = Object.freeze([
  'startup',
  'help',
  'clear',
  'vibe-mode',
  'autocomplete',
  'prompt-entry',
  'escape-cancel',
  'permission-mode',
  'exit',
]);
const OBSERVATION_ONLY_TUI_SCENARIOS = new Set(['startup', 'permission-mode']);
const REQUIRED_TUI_INPUT_SCENARIOS = Object.freeze(
  REQUIRED_TUI_SCENARIOS.filter((scenario) => !OBSERVATION_ONLY_TUI_SCENARIOS.has(scenario)),
);
const TUI_PROMPT_ENTRY_TEXT = 'visible qa prompt entry only';
const TUI_VIBE_MODE_TEXT = 'Vibe mode: ON';
const TUI_SCREEN_SIGNAL_PATTERNS = Object.freeze([
  { name: 'kimi', pattern: /\bkimi\b/i },
  { name: 'moonshot', pattern: /moonshot/i },
  { name: 'slash-command', pattern: /\/(?:help|clear|exit|vibe)/i },
  { name: 'editor', pattern: /\b(?:ask|message|editor|prompt)\b/i },
  { name: 'auto-permission', pattern: /\bauto\b|\bpermission\b|\bapproval\b/i },
  { name: 'vibe-mode', pattern: /vibe mode/i },
  { name: 'prompt-entry', pattern: /visible qa prompt entry only/i },
]);
const DEFAULT_BUDGETS = Object.freeze({
  wallClockMs: 30_000,
  commandCount: 10,
  estimatedTokens: 800,
});
const TUI_UX_SCORE_THRESHOLD = 85;
const TUI_TARGET_DURATION_MS = 30_000;
const PRIMARY_TUI_SUCCESS_SURFACE = 'live-tui-real-user-workflow';
const AUXILIARY_PROMPT_BENCH_SURFACE = 'prompt-only-benchmarks-auxiliary-regression-signal';
const ULTRAWORK_CONTRACT_PATH = 'apps/kimi-code/src/tui/commands/ultrawork-contract.ts';
const WEB_UI_SUCCESS_BOUNDARY =
  'Do not use apps/kimi-web or browser UI paths as a success surface';
const SECRET_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\b[A-Za-z0-9_]*API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/,
  /\bclient_secret\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]);

function usage() {
  return `Usage: node scripts/kimi-agent-sota-gate.mjs [options]

Local Super Kimi SOTA evidence gate.

Required inputs:
  --system-summary <path>             bench-system phase summary JSON.
  --loop-summary <path>               bench-system-loop phase summary JSON.
  --tui-summary <path>                live TUI launch summary JSON.

Options:
  --help                              Show this help.
  --criteria <path>                   Rubric JSON. Default: ${DEFAULT_CRITERIA_PATH}
  --output-dir <dir>                  Report directory. Default: ${DEFAULT_OUTPUT_BASE}/<run-id>
  --max-wall-clock-ms <n>             System benchmark wall-clock budget.
  --max-command-count <n>             System benchmark command-count budget.
  --max-estimated-tokens <n>          System benchmark estimated-token budget.
  --baseline-sota-summary <path>      Optional prior SOTA gate summary for live TUI UX delta checks.
                                       When omitted, the latest prior PASS summary under ${DEFAULT_EVIDENCE_ROOT} is used when available.
  --require-cleanup-receipt           Fail when cleanup receipts are missing.

Reports:
  Writes sota-gate-summary.json and sota-gate-summary.md.
`;
}

function createRunId() {
  return new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14) + '-' + randomUUID().slice(0, 8);
}

function parseArgs(argv) {
  const options = {
    criteria: DEFAULT_CRITERIA_PATH,
    baselineSotaSummary: undefined,
    help: false,
    loopSummary: undefined,
    maxCommandCount: undefined,
    maxEstimatedTokens: undefined,
    maxWallClockMs: undefined,
    outputDir: undefined,
    requireCleanupReceipt: false,
    systemSummary: undefined,
    tuiSummary: undefined,
  };
  const errors = [];
  const valueOptions = new Set([
    '--criteria',
    '--output-dir',
    '--system-summary',
    '--loop-summary',
    '--tui-summary',
    '--max-wall-clock-ms',
    '--max-command-count',
    '--max-estimated-tokens',
    '--baseline-sota-summary',
  ]);
  const booleanOptions = new Set(['--help', '--require-cleanup-receipt']);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inlineValue] = splitOption(raw);
    if (booleanOptions.has(flag)) {
      if (inlineValue !== undefined) errors.push(`${flag} does not accept a value`);
      else if (flag === '--help') options.help = true;
      else options.requireCleanupReceipt = true;
      continue;
    }
    if (valueOptions.has(flag)) {
      let value = inlineValue;
      if (value === undefined) {
        index += 1;
        value = argv[index];
      }
      if (value === undefined || value.startsWith('--')) {
        errors.push(`${flag} requires a value`);
        if (value !== undefined) index -= 1;
        continue;
      }
      setValueOption(options, flag, value, errors);
      continue;
    }
    errors.push(`Unknown option: ${raw}`);
  }

  if (!options.help) {
    if (options.systemSummary === undefined) errors.push('Missing required input: --system-summary <path>');
    if (options.loopSummary === undefined) errors.push('Missing required input: --loop-summary <path>');
    if (options.tuiSummary === undefined) errors.push('Missing required input: --tui-summary <path>');
  }
  return { errors, options };
}

function splitOption(raw) {
  if (!raw.startsWith('--')) return [raw, undefined];
  const equalsIndex = raw.indexOf('=');
  if (equalsIndex === -1) return [raw, undefined];
  return [raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1)];
}

function setValueOption(options, flag, value, errors) {
  if (flag === '--criteria') options.criteria = value;
  if (flag === '--output-dir') options.outputDir = value;
  if (flag === '--system-summary') options.systemSummary = value;
  if (flag === '--loop-summary') options.loopSummary = value;
  if (flag === '--tui-summary') options.tuiSummary = value;
  if (flag === '--max-wall-clock-ms') options.maxWallClockMs = parsePositiveInteger(flag, value, errors);
  if (flag === '--max-command-count') options.maxCommandCount = parsePositiveInteger(flag, value, errors);
  if (flag === '--max-estimated-tokens') options.maxEstimatedTokens = parsePositiveInteger(flag, value, errors);
  if (flag === '--baseline-sota-summary') options.baselineSotaSummary = value;
}

function parsePositiveInteger(flag, value, errors) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.push(`${flag} must be a positive integer`);
    return undefined;
  }
  return parsed;
}

async function main() {
  const { errors, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exitCode = errors.length === 0 ? 0 : 1;
    if (errors.length > 0) console.error(`Error: ${errors.join('; ')}`);
    return;
  }
  if (errors.length > 0) {
    console.error(`SOTA gate input error: ${errors.join('; ')}`);
    console.error('Run with --help for usage.');
    process.exitCode = 2;
    return;
  }

  const runId = createRunId();
  const outputDir = path.resolve(options.outputDir ?? path.join(DEFAULT_OUTPUT_BASE, runId));
  await mkdir(outputDir, { recursive: true });

  const report = await buildReport(options, outputDir, runId);
  const jsonPath = path.join(outputDir, 'sota-gate-summary.json');
  const markdownPath = path.join(outputDir, 'sota-gate-summary.md');
  await writeJson(jsonPath, report);
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');

  console.log(`Status: ${report.status}`);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
  if (report.status !== 'PASS') {
    console.error(`Reason: ${report.reason}`);
    process.exitCode = 1;
  }
}

async function buildReport(options, outputDir, runId) {
  const startedAt = new Date().toISOString();
  const criteriaPath = path.resolve(options.criteria);
  const criteria = await readJsonRequired(criteriaPath, 'criteria');
  const budgets = {
    wallClockMs:
      options.maxWallClockMs ?? criteria.budgetDefaults?.wallClockMs ?? DEFAULT_BUDGETS.wallClockMs,
    commandCount:
      options.maxCommandCount ?? criteria.budgetDefaults?.commandCount ?? DEFAULT_BUDGETS.commandCount,
    estimatedTokens:
      options.maxEstimatedTokens ??
      criteria.budgetDefaults?.estimatedTokens ??
      DEFAULT_BUDGETS.estimatedTokens,
  };
  const evidenceInputs = {
    systemSummary: path.resolve(options.systemSummary),
    loopSummary: path.resolve(options.loopSummary),
    tuiSummary: path.resolve(options.tuiSummary),
  };
  const baselineSelection = await selectBaselineSotaSummary(options, outputDir);
  const inputs = { ...evidenceInputs };
  if (baselineSelection !== undefined) inputs.baselineSotaSummary = baselineSelection.path;
  const systemSummary = await readJsonRequired(evidenceInputs.systemSummary, 'bench-system summary');
  const loopSummary = await readJsonRequired(evidenceInputs.loopSummary, 'bench-system-loop summary');
  const tuiSummary = await readJsonRequired(evidenceInputs.tuiSummary, 'live TUI summary');

  const tuiGate = await evaluateTuiGate(tuiSummary);
  const gates = [
    evaluateSystemGate(systemSummary),
    evaluateLoopGate(loopSummary),
    tuiGate,
    evaluateBudgetGate(systemSummary, budgets),
    await evaluateNoWebUiSurfaceGate(evidenceInputs),
    await evaluateSecretScanGate(inputs, criteriaPath),
    await evaluateCleanupReceiptGate(evidenceInputs, options.requireCleanupReceipt),
  ];
  const tuiUxDelta =
    baselineSelection === undefined
      ? undefined
      : evaluateTuiUxDeltaGate(baselineSelection.summary, tuiGate.observed?.uxFriction);
  if (tuiUxDelta !== undefined) gates.push(tuiUxDelta);
  const tuiNextActions = recommendTuiNextActions(tuiGate, tuiUxDelta);
  const status = gates.every((gate) => gate.status === 'PASS' || gate.required === false) ? 'PASS' : 'FAIL';
  return {
    schemaVersion: 1,
    gate: 'super-kimi-agent-sota-gate',
    runId,
    status,
    reason:
      status === 'PASS'
        ? 'All required SOTA gates passed against local bench and live TUI artifacts.'
        : gates.filter((gate) => gate.status !== 'PASS' && gate.required !== false).map((gate) => gate.reason).join('; '),
    startedAt,
    completedAt: new Date().toISOString(),
    outputDir,
    criteriaPath,
    criteriaVersion: criteria.schemaVersion,
    inputs,
    budgets,
    requiredTuiScenarios: REQUIRED_TUI_SCENARIOS,
    requiredTuiObservationScenarios: REQUIRED_TUI_SCENARIOS,
    requiredTuiInputScenarios: REQUIRED_TUI_INPUT_SCENARIOS,
    primarySuccessSurface: PRIMARY_TUI_SUCCESS_SURFACE,
    auxiliarySuccessSurfaces: [AUXILIARY_PROMPT_BENCH_SURFACE],
    tuiUxBaseline: baselineSelection?.metadata,
    tuiUxFriction: tuiGate.observed?.uxFriction,
    tuiUxDelta: tuiUxDelta?.observed,
    tuiNextActions,
    gates,
    rubricReferences: criteria.references ?? [],
  };
}

function evaluateSystemGate(summary) {
  const bench = summary.benchSummary;
  const failures = [];
  if (summary.status !== 'PASS') failures.push(`phase status is ${String(summary.status)}`);
  if (bench?.status !== 'PASS') failures.push(`benchmark status is ${String(bench?.status)}`);
  if (bench?.suite !== 'system') failures.push(`benchmark suite is ${String(bench?.suite)}`);
  if (bench?.metrics?.score !== 1) failures.push(`score is ${String(bench?.metrics?.score)}`);
  if (bench?.metrics?.passRate !== 1) failures.push(`passRate is ${String(bench?.metrics?.passRate)}`);
  if ((bench?.counts?.scored ?? 0) < 1) failures.push('no scored system tasks');
  return {
    name: 'system-score-pass-rate',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'bench-system status PASS with system score/passRate == 1.'
        : failures.join('; '),
    observed: {
      phaseStatus: summary.status,
      benchmarkStatus: bench?.status,
      suite: bench?.suite,
      score: bench?.metrics?.score,
      passRate: bench?.metrics?.passRate,
      scored: bench?.counts?.scored,
      summaryFile: summary.summaryFile,
    },
  };
}

function evaluateLoopGate(summary) {
  const bench = summary.benchSummary;
  const failures = [];
  if (summary.status !== 'PASS') failures.push(`phase status is ${String(summary.status)}`);
  if (bench?.status !== 'PASS') failures.push(`loop status is ${String(bench?.status)}`);
  if (bench?.bestScore !== 1) failures.push(`bestScore is ${String(bench?.bestScore)}`);
  if (bench?.guardrails?.bounded !== true) failures.push('bounded guardrail is not true');
  if (bench?.guardrails?.executeCodeChanges !== false) failures.push('loop is allowed to execute code changes');
  if (!Array.isArray(bench?.iterations) || bench.iterations.length === 0) failures.push('loop iterations are missing');
  return {
    name: 'bounded-loop-best-score',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'bench-system-loop status PASS with bounded guardrails and bestScore == 1.'
        : failures.join('; '),
    observed: {
      phaseStatus: summary.status,
      loopStatus: bench?.status,
      bestScore: bench?.bestScore,
      stopReason: bench?.stopReason,
      bounded: bench?.guardrails?.bounded,
      executeCodeChanges: bench?.guardrails?.executeCodeChanges,
      iterations: Array.isArray(bench?.iterations) ? bench.iterations.length : 0,
      wallClockMs: bench?.wallClockMs,
    },
  };
}

async function selectBaselineSotaSummary(options, outputDir) {
  if (options.baselineSotaSummary !== undefined) {
    const baselinePath = path.resolve(options.baselineSotaSummary);
    const summary = await readJsonRequired(baselinePath, 'baseline SOTA gate summary');
    return buildBaselineSelection('explicit', baselinePath, summary);
  }
  return findLatestAutoBaselineSotaSummary(path.resolve(DEFAULT_EVIDENCE_ROOT), outputDir);
}

async function findLatestAutoBaselineSotaSummary(evidenceRoot, outputDir) {
  const candidates = await findSotaSummaryFiles(evidenceRoot, {
    excludeDir: outputDir,
    limit: AUTO_BASELINE_SCAN_LIMIT,
  });
  for (const candidate of candidates) {
    const summary = await readJsonIfFile(candidate.path);
    if (!isUsableSotaBaseline(summary)) continue;
    return buildBaselineSelection('auto', candidate.path, summary, candidate.modifiedAt);
  }
  return undefined;
}

async function findSotaSummaryFiles(rootDir, options) {
  const files = [];
  const stack = [''];
  while (stack.length > 0 && files.length < options.limit) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(rootDir, relativeDir);
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      const absolutePath = path.join(rootDir, relativePath);
      if (isPathInside(absolutePath, options.excludeDir)) continue;
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile() || entry.name !== SOTA_SUMMARY_FILENAME) continue;
      const info = await fileStatOrUndefined(absolutePath);
      if (info === undefined) continue;
      files.push({ path: absolutePath, modifiedAt: info.mtimeMs });
      if (files.length >= options.limit) break;
    }
  }
  return files.toSorted((left, right) => right.modifiedAt - left.modifiedAt);
}

function buildBaselineSelection(mode, baselinePath, summary, modifiedAt) {
  const friction = extractTuiUxFriction(summary);
  return {
    mode,
    path: baselinePath,
    summary,
    metadata: {
      status: 'FOUND',
      mode,
      path: baselinePath,
      runId: summary.runId,
      reportStatus: summary.status,
      score: friction?.score,
      frictionStatus: friction?.status,
      durationMs: friction?.durationMs,
      modifiedAt,
    },
  };
}

function isUsableSotaBaseline(summary) {
  const friction = extractTuiUxFriction(summary);
  return (
    summary?.gate === 'super-kimi-agent-sota-gate' &&
    summary.status === 'PASS' &&
    friction?.status === 'PASS' &&
    typeof friction.score === 'number'
  );
}

async function evaluateTuiGate(summary) {
  const failures = [];
  const captures = Array.isArray(summary.captures) ? summary.captures : [];
  const inputTraces = Array.isArray(summary.inputTraces) ? summary.inputTraces : [];
  if (summary.status !== 'PASS') failures.push(`TUI summary status is ${String(summary.status)}`);
  const scenarioResults = [];
  for (const scenario of REQUIRED_TUI_SCENARIOS) {
    const capture = captures.find((entry) => entry.scenario === scenario);
    const file = capture?.path;
    const artifact = file === undefined ? { exists: false, bytes: 0 } : await fileStatus(file);
    const capturePassed = capture?.status === 'PASS' && artifact.exists && artifact.bytes > 0;
    const screenValidation = await validateTuiScreenArtifact(scenario, file, artifact);
    const inputTrace = inputTraces.find((entry) => entry.scenario === scenario);
    const inputValidation = validateTuiInputTrace(scenario, inputTrace);
    const inputPassed =
      inputValidation.status === 'PASS' || inputValidation.status === 'NOT_REQUIRED';
    const passed = capturePassed && screenValidation.status === 'PASS' && inputPassed;
    if (!passed) failures.push(`missing passing live TUI scenario: ${scenario}`);
    scenarioResults.push({
      scenario,
      status: passed ? 'PASS' : 'FAIL',
      captureStatus: capture?.status,
      path: file,
      bytes: artifact.bytes,
      screenObservationStatus: screenValidation.status,
      screenObservationReason: screenValidation.reason,
      screenObservationSignals: screenValidation.signals,
      visibleTextSample: screenValidation.visibleTextSample,
      inputTraceStatus: inputValidation.status,
      inputTraceReason: inputValidation.reason,
      inputSteps: inputValidation.steps,
      inputKeys: inputValidation.keys,
    });
  }
  const uxFriction = scoreTuiUxFriction(summary, scenarioResults);
  if (uxFriction.status !== 'PASS') failures.push(uxFriction.reason);
  return {
    name: 'live-tui-required-scenarios',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'All required live TUI scenarios have passing capture artifacts, screen observations, and input traces.'
        : failures.join('; '),
    observed: {
      summaryStatus: summary.status,
      exitSessionClosed: summary.validations?.exitSessionClosed?.status,
      requiredObservationScenarios: REQUIRED_TUI_SCENARIOS,
      requiredInputScenarios: REQUIRED_TUI_INPUT_SCENARIOS,
      uxFriction,
      scenarios: scenarioResults,
    },
  };
}

function evaluateTuiUxDeltaGate(baselineSummary, currentFriction) {
  const baselineFriction = extractTuiUxFriction(baselineSummary);
  const baselineScore = baselineFriction?.score;
  const currentScore = currentFriction?.score;
  const failures = [];
  if (typeof baselineScore !== 'number') failures.push('baseline live TUI UX friction score is missing');
  if (typeof currentScore !== 'number') failures.push('current live TUI UX friction score is missing');
  const scoreDelta =
    typeof baselineScore === 'number' && typeof currentScore === 'number'
      ? currentScore - baselineScore
      : undefined;
  if (scoreDelta !== undefined && scoreDelta < 0) {
    failures.push(`live TUI UX friction score regressed by ${String(scoreDelta)}`);
  }
  const durationDeltaMs =
    typeof baselineFriction?.durationMs === 'number' && typeof currentFriction?.durationMs === 'number'
      ? currentFriction.durationMs - baselineFriction.durationMs
      : undefined;
  return {
    name: 'live-tui-ux-friction-delta',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? `live TUI UX friction did not regress; score delta ${formatSignedNumber(scoreDelta ?? 0)}.`
        : failures.join('; '),
    observed: {
      baselineScore,
      currentScore,
      scoreDelta,
      baselineDurationMs: baselineFriction?.durationMs,
      currentDurationMs: currentFriction?.durationMs,
      durationDeltaMs,
      verdict:
        scoreDelta === undefined
          ? 'unknown'
          : scoreDelta > 0
            ? 'improved'
            : scoreDelta === 0
              ? 'no-regression'
              : 'regressed',
      baselineRunId: baselineSummary.runId,
      baselineStatus: baselineSummary.status,
      currentStatus: currentFriction?.status,
    },
  };
}

function recommendTuiNextActions(tuiGate, tuiUxDeltaGate) {
  const uxFriction = tuiGate.observed?.uxFriction;
  const scenarios = Array.isArray(tuiGate.observed?.scenarios) ? tuiGate.observed.scenarios : [];
  const penalties = Array.isArray(uxFriction?.penalties) ? uxFriction.penalties : [];
  const actions = [];
  const addAction = (kind, reason, evidence, command) => {
    actions.push({
      priority: actions.length + 1,
      kind,
      reason,
      evidence,
      command,
    });
  };

  if (tuiUxDeltaGate?.observed?.verdict === 'regressed') {
    addAction(
      'fix-live-tui-regression',
      'Current live TUI friction regressed against the selected baseline; fix the failing screen or input evidence before tuning prompt-only benchmarks.',
      {
        baselineScore: tuiUxDeltaGate.observed.baselineScore,
        currentScore: tuiUxDeltaGate.observed.currentScore,
        scoreDelta: tuiUxDeltaGate.observed.scoreDelta,
      },
    );
  }

  for (const penalty of penalties) {
    switch (penalty.name) {
      case 'failed-scenarios':
        addAction(
          'repair-required-live-tui-scenarios',
          'One or more required TUI scenarios did not produce passing screen and input evidence.',
          { scenarios: scenarioNames(penalty.detail) },
          'node scripts/qa-super-kimi-autonomous.mjs --phase tui-launch --evidence-root .omo/evidence/<live-tui-after-fix>',
        );
        break;
      case 'screen-observation':
        addAction(
          'repair-screen-observation',
          'The gate could not recognize real Kimi TUI content in one or more captured screens.',
          { scenarios: scenarioNames(penalty.detail) },
          'node scripts/qa-super-kimi-autonomous.mjs --phase tui-launch --evidence-root .omo/evidence/<screen-observation-after-fix>',
        );
        break;
      case 'input-trace':
        addAction(
          'repair-keyboard-input-trace',
          'A required TUI scenario is missing ordered keyboard input proof, so the run is too close to blind output checking.',
          { scenarios: scenarioNames(penalty.detail) },
          'node scripts/qa-super-kimi-autonomous.mjs --phase tui-launch --evidence-root .omo/evidence/<input-trace-after-fix>',
        );
        break;
      case 'exit-cleanup':
        addAction(
          'repair-exit-cleanup',
          'The TUI session did not prove that /exit closed the live terminal session cleanly.',
          penalty.detail,
          'node scripts/qa-super-kimi-autonomous.mjs --phase tui-launch --evidence-root .omo/evidence/<exit-cleanup-after-fix>',
        );
        break;
      case 'duration':
        addAction(
          'reduce-live-tui-latency',
          'The live TUI run exceeded the target wall-clock duration or lacked timing evidence.',
          penalty.detail,
        );
        break;
      case 'command-failures':
      case 'command-timeouts':
        addAction(
          'repair-tui-harness-commands',
          'The terminal harness command layer failed or timed out while driving the TUI.',
          penalty.detail,
        );
        break;
      default:
        addAction(
          'inspect-live-tui-friction-penalty',
          `Inspect live TUI friction penalty ${penalty.name}.`,
          penalty.detail,
        );
        break;
    }
  }

  if (actions.length === 0) {
    addAction(
      'expand-to-real-vibe-coding-task',
      'Current live TUI smoke interaction evidence passes; the next loop should drive one realistic coding change through the TUI and score screen state, key trace, diff, tests, and cleanup as the primary evidence.',
      {
        currentScore: uxFriction?.score,
        deltaVerdict: tuiUxDeltaGate?.observed?.verdict ?? 'not-compared',
        passingScenarios: scenarios
          .filter((scenario) => scenario.status === 'PASS')
          .map((scenario) => scenario.scenario),
      },
      'node scripts/qa-super-kimi-autonomous.mjs --phase tui-launch --evidence-root .omo/evidence/<real-vibe-coding-before-after>',
    );
  }

  return {
    status: actions.some(isBlockingTuiNextAction)
      ? 'BLOCKED_ON_LIVE_TUI_EVIDENCE'
      : 'READY_FOR_HARDER_REAL_WORKFLOW',
    primarySurface: PRIMARY_TUI_SUCCESS_SURFACE,
    auxiliarySurfaces: [AUXILIARY_PROMPT_BENCH_SURFACE],
    principle:
      'Prompt-only benchmark runs are auxiliary regression signals; the primary gate must stay grounded in observed TUI screens, ordered user input, and realistic coding workflow evidence.',
    actions,
  };
}

function isBlockingTuiNextAction(action) {
  return action.kind.startsWith('repair') ? true : action.kind.includes('regression');
}

function scenarioNames(detail) {
  return Array.isArray(detail)
    ? detail.map((entry) => entry?.scenario).filter((scenario) => typeof scenario === 'string')
    : [];
}

function extractTuiUxFriction(summary) {
  if (summary?.tuiUxFriction !== undefined) return summary.tuiUxFriction;
  const tuiGate = Array.isArray(summary?.gates)
    ? summary.gates.find((gate) => gate.name === 'live-tui-required-scenarios')
    : undefined;
  return tuiGate?.observed?.uxFriction;
}

function formatSignedNumber(value) {
  return value >= 0 ? `+${String(value)}` : String(value);
}

async function validateTuiScreenArtifact(scenario, file, artifact) {
  if (file === undefined) {
    return {
      status: 'FAIL',
      reason: 'missing screen capture path for scenario.',
      signals: [],
      visibleTextSample: undefined,
    };
  }
  if (!artifact.exists || artifact.bytes <= 0) {
    return {
      status: 'FAIL',
      reason: 'screen capture artifact is missing or empty.',
      signals: [],
      visibleTextSample: undefined,
    };
  }
  try {
    return inspectTuiScreenText(scenario, await readFile(file, 'utf8'));
  } catch (error) {
    return {
      status: 'FAIL',
      reason: `failed to read screen capture: ${error instanceof Error ? error.message : String(error)}`,
      signals: [],
      visibleTextSample: undefined,
    };
  }
}

function inspectTuiScreenText(scenario, output) {
  const normalized = normalizeScreenText(output);
  const lines = output.split(/\r?\n/);
  const nonBlankLineCount = lines.filter((line) => line.trim().length > 0).length;
  const signals = detectTuiScreenSignals(normalized);
  const failures = [];
  if (normalized.length === 0) failures.push('visible text sample is empty');
  if (nonBlankLineCount === 0) failures.push('capture has no non-blank screen lines');
  if (!hasKimiTuiChrome(normalized)) {
    failures.push('capture does not show recognizable Kimi TUI chrome/content');
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
    case 'clear':
      if (!matchesAny(normalized, [/kimi/i, /message/i, /editor/i, /prompt/i])) {
        failures.push('clear capture does not show a returned Kimi prompt/editor state');
      }
      break;
    case 'vibe-mode':
      if (!normalized.includes(TUI_VIBE_MODE_TEXT)) {
        failures.push(`vibe-mode capture does not show local Vibe mode activation: "${TUI_VIBE_MODE_TEXT}"`);
      }
      if (!matchesAny(normalized, [/direct coding/i, /no plan gate/i, /plan mode disabled/i])) {
        failures.push('vibe-mode capture does not show direct-coding/no-plan feedback');
      }
      break;
    case 'autocomplete':
      if (!matchesAny(normalized, [/\/help/i, /\/clear/i, /commands?/i, /autocomplete/i, /\bauto\b.*\bmodel\b.*\bpermission\b/i, /\(\d+\/\d+\)/])) {
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
    case 'exit':
      if (!normalized.includes('/exit')) {
        failures.push('exit capture does not show the /exit command before submission');
      }
      break;
    default:
      failures.push(`unexpected TUI capture scenario: ${scenario}`);
      break;
  }
  if (signals.length === 0) failures.push('screen signals are missing');
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'screen transcript has readable Kimi TUI scenario evidence.'
        : failures.join('; '),
    signals,
    visibleTextSample: truncateScreenSample(normalized),
    lineCount: lines.length,
    nonBlankLineCount,
  };
}

function detectTuiScreenSignals(output) {
  return TUI_SCREEN_SIGNAL_PATTERNS.filter((entry) => entry.pattern.test(output)).map(
    (entry) => entry.name,
  );
}

function truncateScreenSample(output) {
  const maxLength = 240;
  if (output.length <= maxLength) return output;
  return `${output.slice(0, maxLength - 3)}...`;
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

function matchesAny(output, patterns) {
  return patterns.some((pattern) => pattern.test(output));
}

function scoreTuiUxFriction(summary, scenarioResults) {
  const penalties = [];
  const failedScenarios = scenarioResults.filter((scenario) => scenario.status !== 'PASS');
  const screenFailures = scenarioResults.filter(
    (scenario) => scenario.screenObservationStatus !== 'PASS',
  );
  const inputFailures = scenarioResults.filter((scenario) => scenario.inputTraceStatus === 'FAIL');
  const durationMs = durationBetween(summary.startedAt, summary.completedAt);
  addPenalty(penalties, 'failed-scenarios', Math.min(60, failedScenarios.length * 20), failedScenarios);
  addPenalty(penalties, 'screen-observation', Math.min(40, screenFailures.length * 10), screenFailures);
  addPenalty(penalties, 'input-trace', Math.min(35, inputFailures.length * 8), inputFailures);
  if (summary.validations?.exitSessionClosed?.status !== 'PASS') {
    addPenalty(penalties, 'exit-cleanup', 10, summary.validations?.exitSessionClosed);
  }
  if (durationMs === undefined) {
    addPenalty(penalties, 'duration', 5, 'missing startedAt/completedAt timing');
  } else if (durationMs > TUI_TARGET_DURATION_MS) {
    addPenalty(
      penalties,
      'duration',
      Math.min(15, Math.ceil((durationMs - TUI_TARGET_DURATION_MS) / 5_000) * 3),
      { durationMs, targetMs: TUI_TARGET_DURATION_MS },
    );
  }
  const commandFriction = scoreTuiCommandFriction(summary.commands);
  for (const penalty of commandFriction.penalties) penalties.push(penalty);
  const score = Math.max(0, 100 - penalties.reduce((sum, penalty) => sum + penalty.points, 0));
  return {
    status: score >= TUI_UX_SCORE_THRESHOLD ? 'PASS' : 'FAIL',
    score,
    threshold: TUI_UX_SCORE_THRESHOLD,
    reason:
      score >= TUI_UX_SCORE_THRESHOLD
        ? `live TUI UX friction score ${score} meets threshold ${TUI_UX_SCORE_THRESHOLD}.`
        : `live TUI UX friction score ${score} is below threshold ${TUI_UX_SCORE_THRESHOLD}.`,
    durationMs,
    dimensions: {
      scenarioPassRate: roundRatio(
        scenarioResults.filter((scenario) => scenario.status === 'PASS').length,
        REQUIRED_TUI_SCENARIOS.length,
      ),
      screenObservationPassRate: roundRatio(
        scenarioResults.filter((scenario) => scenario.screenObservationStatus === 'PASS').length,
        REQUIRED_TUI_SCENARIOS.length,
      ),
      requiredInputTracePassRate: roundRatio(
        scenarioResults.filter(
          (scenario) =>
            scenario.inputTraceStatus === 'PASS' || scenario.inputTraceStatus === 'NOT_REQUIRED',
        ).length,
        REQUIRED_TUI_SCENARIOS.length,
      ),
      commandFailureCount: commandFriction.failedCommands,
      commandTimeoutCount: commandFriction.timedOutCommands,
    },
    penalties,
  };
}

function addPenalty(penalties, name, points, detail) {
  if (points <= 0) return;
  penalties.push({ name, points, detail });
}

function scoreTuiCommandFriction(commands) {
  const records = Array.isArray(commands) ? commands : [];
  const failedCommands = records.filter((command) => command.exitCode !== 0);
  const timedOutCommands = records.filter((command) => command.timedOut === true);
  const penalties = [];
  addPenalty(penalties, 'command-failures', Math.min(20, failedCommands.length * 5), {
    count: failedCommands.length,
    names: failedCommands.map((command) => command.name),
  });
  addPenalty(penalties, 'command-timeouts', Math.min(20, timedOutCommands.length * 10), {
    count: timedOutCommands.length,
    names: timedOutCommands.map((command) => command.name),
  });
  return {
    failedCommands: failedCommands.length,
    timedOutCommands: timedOutCommands.length,
    penalties,
  };
}

function durationBetween(startedAt, completedAt) {
  const start = Date.parse(String(startedAt));
  const end = Date.parse(String(completedAt));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}

function roundRatio(numerator, denominator) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function validateTuiInputTrace(scenario, trace) {
  if (!REQUIRED_TUI_INPUT_SCENARIOS.includes(scenario)) {
    return {
      status: 'NOT_REQUIRED',
      reason: 'observation-only scenario has no required key input trace.',
      steps: 0,
      keys: [],
    };
  }
  if (trace === undefined) {
    return {
      status: 'FAIL',
      reason: 'missing input trace for scenario.',
      steps: 0,
      keys: [],
    };
  }
  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const keys = Array.isArray(trace.keys) ? trace.keys : [];
  const failures = [];
  if (trace.status !== 'PASS') failures.push(`trace status is ${String(trace.status)}`);
  if (steps.length === 0) failures.push('trace has no ordered steps');
  if (keys.length === 0) failures.push('trace has no flattened keys');
  for (const step of steps) {
    if (step?.exitCode !== 0) {
      failures.push(`step ${String(step?.index)} exitCode=${String(step?.exitCode)}`);
    }
    if (step?.timedOut === true) failures.push(`step ${String(step?.index)} timed out`);
    if (!Array.isArray(step?.keys) || step.keys.length === 0) {
      failures.push(`step ${String(step?.index)} has no keys`);
    }
  }
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    reason:
      failures.length === 0
        ? 'input trace has ordered key steps with successful tmux sends.'
        : failures.join('; '),
    steps: steps.length,
    keys,
  };
}

function evaluateBudgetGate(summary, budgets) {
  const metrics = summary.benchSummary?.metrics ?? {};
  const checks = [
    {
      metric: 'wallClockMs',
      observed: metrics.wallClockMs,
      max: budgets.wallClockMs,
    },
    {
      metric: 'commandCount',
      observed: metrics.commandCount,
      max: budgets.commandCount,
    },
    {
      metric: 'estimatedTokens',
      observed: metrics.estimatedTokens,
      max: budgets.estimatedTokens,
    },
  ];
  const failures = checks
    .filter((check) => typeof check.observed !== 'number' || check.observed > check.max)
    .map((check) => `${check.metric}=${String(check.observed)} exceeds max ${check.max}`);
  return {
    name: 'system-budget',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'System benchmark stayed within wallClockMs, commandCount, and estimatedTokens budgets.'
        : failures.join('; '),
    observed: Object.fromEntries(checks.map((check) => [check.metric, check.observed])),
    max: budgets,
  };
}

async function evaluateNoWebUiSurfaceGate(inputs) {
  const contractPath = path.resolve(ULTRAWORK_CONTRACT_PATH);
  const contractArtifact = await fileStatus(contractPath);
  const failures = [];
  let contractHasBoundary = false;
  if (!contractArtifact.exists || contractArtifact.bytes === 0) {
    failures.push(`missing Ultrawork contract: ${ULTRAWORK_CONTRACT_PATH}`);
  } else {
    const contract = await readFile(contractPath, 'utf8');
    contractHasBoundary = contract.includes(WEB_UI_SUCCESS_BOUNDARY);
    if (!contractHasBoundary) {
      failures.push(`Ultrawork contract is missing boundary text: ${WEB_UI_SUCCESS_BOUNDARY}`);
    }
  }

  const inputEntries = Object.entries(inputs).map(([name, inputPath]) => [name, String(inputPath)]);
  const webUiInputs = inputEntries
    .filter(([, inputPath]) => pathSegments(inputPath).includes('apps') && pathSegments(inputPath).includes('kimi-web'))
    .map(([name, inputPath]) => `${name}=${inputPath}`);
  if (webUiInputs.length > 0) {
    failures.push(`gate inputs point at apps/kimi-web: ${webUiInputs.join(', ')}`);
  }

  return {
    name: 'no-web-ui-success-surface',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason: failures.length === 0
      ? 'Gate success is based only on bench-system, bounded loop, and live terminal/TUI artifacts; the Ultrawork contract explicitly excludes apps/kimi-web/browser UI success.'
      : failures.join('; '),
    observed: {
      checkedInputs: ['bench-system summary', 'bench-system-loop summary', 'live TUI summary'],
      checkedInputPaths: inputs,
      contractPath,
      contractBytes: contractArtifact.bytes,
      contractHasBoundary,
      excludedSuccessSurfaces: ['apps/kimi-web', 'browser UI'],
    },
  };
}

async function evaluateSecretScanGate(inputs, criteriaPath) {
  const files = [criteriaPath, ...Object.values(inputs)];
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      findings.push({ file, reason: `could not read: ${error.message}` });
      continue;
    }
    const matchedPatterns = SECRET_PATTERNS
      .map((pattern) => pattern.source)
      .filter((source, index) => SECRET_PATTERNS[index].test(text));
    if (matchedPatterns.length > 0) {
      findings.push({ file, matchedPatterns });
    }
  }
  return {
    name: 'no-secret-like-evidence',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      findings.length === 0
        ? 'Criteria and input evidence summaries contain no obvious secret-like tokens.'
        : `Secret-like evidence found in: ${findings.map((finding) => finding.file).join(', ')}`,
    observed: {
      scannedFiles: files,
      findings,
    },
  };
}

async function evaluateCleanupReceiptGate(inputs, required) {
  const receipts = await Promise.all(
    Object.entries(inputs).map(async ([name, inputPath]) => {
      const receiptPath = cleanupReceiptPathFor(inputPath);
      const artifact = receiptPath === undefined ? { exists: false, bytes: 0 } : await fileStatus(receiptPath);
      return {
        input: name,
        path: receiptPath,
        status: artifact.exists && artifact.bytes > 0 ? 'PRESENT' : 'MISSING',
        bytes: artifact.bytes,
      };
    }),
  );
  const missing = receipts.filter((receipt) => receipt.status !== 'PRESENT');
  const pass = missing.length === 0 || !required;
  return {
    name: 'cleanup-receipt-presence',
    status: pass ? 'PASS' : 'FAIL',
    required,
    reason:
      missing.length === 0
        ? 'Cleanup receipt artifacts are present for all inferred artifact roots.'
        : required
          ? `Missing cleanup receipts for: ${missing.map((receipt) => receipt.input).join(', ')}`
          : `Cleanup receipt presence recorded; missing optional receipts for: ${missing.map((receipt) => receipt.input).join(', ')}`,
    observed: receipts,
  };
}

function pathSegments(file) {
  return path.resolve(file).split(path.sep).filter(Boolean);
}

function cleanupReceiptPathFor(inputPath) {
  const parsed = path.parse(inputPath);
  const parts = inputPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const benchIndex = parts.lastIndexOf('bench');
  if (benchIndex > 0) return path.join(parsed.root, ...parts.slice(0, benchIndex), 'cleanup', 'receipt.json');
  const tuiIndex = parts.lastIndexOf('tui');
  if (tuiIndex > 0) return path.join(parsed.root, ...parts.slice(0, tuiIndex), 'cleanup', 'receipt.json');
  return undefined;
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function fileStatus(file) {
  try {
    const info = await stat(file);
    return { exists: info.isFile(), bytes: info.size };
  } catch {
    return { exists: false, bytes: 0 };
  }
}

async function fileStatOrUndefined(file) {
  try {
    return await stat(file);
  } catch {
    return undefined;
  }
}

async function readJsonIfFile(file) {
  try {
    const text = await readFile(file, 'utf8');
    if (text.trim() === '') return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readJsonRequired(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Missing required ${label}: ${file} (${error.message})`, { cause: error });
  }
  if (text.trim() === '') throw new Error(`Required ${label} is empty: ${file}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Required ${label} is not valid JSON: ${file} (${error.message})`, { cause: error });
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderMarkdown(report) {
  const lines = [
    '# Super Kimi SOTA Gate',
    '',
    `Status: ${report.status}`,
    `Reason: ${report.reason}`,
    '',
    '## Inputs',
    '',
    `- bench-system: ${report.inputs.systemSummary}`,
    `- bench-system-loop: ${report.inputs.loopSummary}`,
    `- live TUI: ${report.inputs.tuiSummary}`,
    ...(report.inputs.baselineSotaSummary === undefined
      ? []
      : [`- baseline SOTA: ${report.inputs.baselineSotaSummary}`]),
    '',
    '## Gates',
    '',
    '| Gate | Status | Required | Reason |',
    '|---|---:|---:|---|',
  ];
  for (const gate of report.gates) {
    lines.push(`| ${gate.name} | ${gate.status} | ${String(gate.required)} | ${escapeMarkdown(gate.reason)} |`);
  }
  lines.push(
    '',
    '## Primary Verification Surface',
    '',
    `- primary: ${report.primarySuccessSurface}`,
    `- auxiliary: ${(report.auxiliarySuccessSurfaces ?? []).join(', ')}`,
  );
  if (report.tuiUxFriction !== undefined) {
    lines.push(
      '',
      '## Live TUI UX Friction',
      '',
      `- score: ${report.tuiUxFriction.score}/${report.tuiUxFriction.threshold}`,
      `- status: ${report.tuiUxFriction.status}`,
      `- durationMs: ${String(report.tuiUxFriction.durationMs ?? 'unavailable')}`,
    );
    for (const penalty of report.tuiUxFriction.penalties) {
      lines.push(`- penalty: ${penalty.name} -${penalty.points}`);
    }
  }
  if (report.tuiUxBaseline !== undefined) {
    lines.push(
      '',
      '## Live TUI UX Baseline',
      '',
      `- mode: ${report.tuiUxBaseline.mode}`,
      `- score: ${String(report.tuiUxBaseline.score ?? 'unavailable')}`,
      `- status: ${report.tuiUxBaseline.reportStatus}`,
      `- path: ${report.tuiUxBaseline.path}`,
    );
  }
  if (report.tuiUxDelta !== undefined) {
    lines.push(
      '',
      '## Live TUI UX Delta',
      '',
      `- baseline score: ${String(report.tuiUxDelta.baselineScore ?? 'unavailable')}`,
      `- current score: ${String(report.tuiUxDelta.currentScore ?? 'unavailable')}`,
      `- score delta: ${formatSignedNumber(report.tuiUxDelta.scoreDelta ?? 0)}`,
      `- verdict: ${report.tuiUxDelta.verdict}`,
      `- duration delta ms: ${String(report.tuiUxDelta.durationDeltaMs ?? 'unavailable')}`,
    );
  }
  if (report.tuiNextActions !== undefined) {
    lines.push(
      '',
      '## Live TUI Next Actions',
      '',
      `- status: ${report.tuiNextActions.status}`,
      `- principle: ${report.tuiNextActions.principle}`,
    );
    for (const action of report.tuiNextActions.actions) {
      const command = action.command === undefined ? '' : ` Command: \`${action.command}\``;
      lines.push(`- P${action.priority} ${action.kind}: ${action.reason}${command}`);
    }
  }
  lines.push(
    '',
    '## Budgets',
    '',
    `- wallClockMs <= ${report.budgets.wallClockMs}`,
    `- commandCount <= ${report.budgets.commandCount}`,
    `- estimatedTokens <= ${report.budgets.estimatedTokens}`,
    '',
    '## Rubric References',
    '',
  );
  for (const reference of report.rubricReferences) {
    lines.push(`- ${reference.name}: ${reference.url} (${reference.principle})`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

try {
  await main();
} catch (error) {
  console.error(`SOTA gate failed: ${error.message}`);
  process.exitCode = 1;
}
