#!/usr/bin/env node
/* eslint-disable no-console */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  defaultUserSurfaceLeakFailures,
  hasLoggedOutSetupNextAction,
  hasStatusPanelSetupNextAction,
  hasXpDodReadinessContract,
  shouldRequireModelSetupAction,
} from './tui-surface-leaks.mjs';
import {
  evidenceSummaryCompletedAtMs,
  isCompleteUltraworkEvidenceSummary,
  missingUltraworkUsageMetricNames,
  ULTRAWORK_SUMMARY_REQUIRED_VALIDATIONS as REQUIRED_ULTRAWORK_VALIDATIONS,
} from './kimi-sota-evidence-contract.mjs';

const DEFAULT_CRITERIA_PATH = '.omo/bench/sota-criteria.json';
const DEFAULT_OUTPUT_BASE = '.omo/evidence/kimi-agent-sota-gate';
const DEFAULT_EVIDENCE_ROOT = '.omo/evidence';
const SOTA_SUMMARY_FILENAME = 'sota-gate-summary.json';
const AUTO_BASELINE_SCAN_LIMIT = 20_000;
const LATEST_PASS_INPUT = 'latest-pass';
const REQUIRED_TUI_SCENARIOS = Object.freeze([
  'startup',
  'help',
  'status',
  'clear',
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
const TUI_ULTRAWORK_WORKFLOW_GUIDANCE = 'SUPER_KIMI_REAL_WORKFLOW_EVIDENCE';
const TUI_SCREEN_SIGNAL_PATTERNS = Object.freeze([
  { name: 'kimi', pattern: /\bkimi\b/i },
  { name: 'moonshot', pattern: /moonshot/i },
  { name: 'slash-command', pattern: /\/(?:help|status|clear|exit)/i },
  { name: 'editor', pattern: /\b(?:ask|message|editor|prompt)\b/i },
  { name: 'auto-permission', pattern: /\bauto\b|\bpermission\b|\bapproval\b/i },
  { name: 'prompt-entry', pattern: /visible qa prompt entry only/i },
  { name: 'status-readiness', pattern: /\breadiness\b.*\bstate\b.*\bchecks\b.*\bnext\b/i },
  { name: 'xp-dod-readiness', pattern: /\bScope\b.*\bCoverage\b.*\bScreen check\b.*\bDone gate\b/i },
  {
    name: 'done-gate',
    pattern: /\bDone gate\b\s+relevant tests\s+\+\s+available typecheck\/lint\/build\s+\+\s+clean diff\s+\+\s+TUI/i,
  },
  { name: 'logged-out-setup-next-action', pattern: /\bmodel:?\s+not set\b.*\bnext:\s*\/login or \/provider,\s*then \/model\b/i },
  { name: 'status-setup-next-action', pattern: /\bState\b\s+Model needed\b.*\bNext\b\s+Run \/login or \/provider first;\s*use \/model after sign-in\./i },
]);
const DEFAULT_BUDGETS = Object.freeze({
  wallClockMs: 30_000,
  commandCount: 10,
  estimatedTokens: 800,
});
const DEFAULT_LOOP_SCORE_THRESHOLD = 90;
const DEFAULT_LOOP_SCORE_RUBRIC = Object.freeze([
  { id: 'vibe-coder-ux', label: 'Vibe coder UX improvement', maxPoints: 20 },
  {
    id: 'autonomy-auto-activation',
    label: 'Autonomy and auto activation quality',
    maxPoints: 15,
  },
  {
    id: 'verification-eyes-hands',
    label: 'Verification and eyes-hands practicality',
    maxPoints: 15,
  },
  { id: 'tui-state-expression', label: 'TUI state expression', maxPoints: 15 },
  {
    id: 'coding-success-bug-prevention',
    label: 'Coding success and bug prevention',
    maxPoints: 15,
  },
  {
    id: 'speed-token-cache-efficiency',
    label: 'Speed, token, and cache efficiency',
    maxPoints: 10,
  },
  { id: 'stuck-loop-stability', label: 'Stuck prevention and loop stability', maxPoints: 10 },
]);
const TUI_UX_SCORE_THRESHOLD = 85;
const TUI_TARGET_DURATION_MS = 30_000;
const PRIMARY_TUI_SUCCESS_SURFACE = 'live-tui-real-user-workflow';
const AUXILIARY_PROMPT_BENCH_SURFACE = 'prompt-only-benchmarks-auxiliary-regression-signal';
const ROOT_EVIDENCE_SUMMARY_FILES = new Set([
  'tui-launch.json',
  'tui-real-workflow.json',
  'tui-ultrawork-workflow.json',
]);
const ULTRAWORK_CONTRACT_PATH = 'apps/kimi-code/src/tui/commands/ultrawork-contract.ts';
const WEB_UI_SUCCESS_BOUNDARY =
  'Do not use apps/kimi-web or browser UI paths as a success surface';
const KNOWLEDGE_MAP_CONTRACT_PHRASES = Object.freeze([
  'Kimi Knowledge Map:',
  'build or refresh a compact project knowledge map',
  'EXTRACTED, INFERRED, or AMBIGUOUS',
  'path/affected-style questions',
]);
const REQUIRED_XP_LITE_CONTRACTS = Object.freeze([
  { name: 'inspect-first', pattern: /\binspect\b.*\bfiles\b.*\btests\b.*\bproject\b/i },
  { name: 'small-focused-change', pattern: /\bsmall\b.*\bfocused\b/i },
  { name: 'test-before-core-logic', pattern: /\btests?\b.*\bbefore\b.*\bcore logic\b/i },
  { name: 'minimum-code', pattern: /\bminimum code\b/i },
  { name: 'verify-available-gates', pattern: /\btests?\b.*\btypecheck\b.*\blint\b.*\bbuild\b/i },
  { name: 'report-blockers', pattern: /\bblockers?\b/i },
  { name: 'finish-summary', pattern: /\bchanged files\b.*\bbehavior changed\b.*\btests run\b.*\bremaining risks\b/i },
]);
const REQUIRED_DEFINITION_OF_DONE_CONTRACTS = Object.freeze([
  { name: 'relevant-tests-pass', pattern: /\brelevant tests pass\b/i },
  { name: 'typecheck-pass', pattern: /\btypecheck passes\b/i },
  { name: 'lint-pass', pattern: /\blint passes\b/i },
  { name: 'no-unrelated-files', pattern: /\bno unrelated files changed\b/i },
  { name: 'no-broad-refactor', pattern: /\bno broad refactor\b/i },
  { name: 'public-behavior-tested', pattern: /\bpublic behavior\b.*\btests\b/i },
  { name: 'real-surface-observed', pattern: /\bTUI\/CLI surface\b.*\bobserved\b/i },
]);
const REQUIRED_HUMAN_WRITING_CONTRACTS = Object.freeze([
  { name: 'harness-level-output-gate', pattern: /\bharness-level output quality gate\b/i },
  {
    name: 'surface-specific-voice-lane',
    pattern: /\bsurface-specific voice lane\b[\s\S]*\bproduct UX microcopy\b[\s\S]*\binstitutional corporate copy\b/i,
  },
  {
    name: 'product-ux-microcopy-lane',
    pattern: /\bproduct UX microcopy\b[\s\S]*friendly 해요체[\s\S]*\bactive wording\b[\s\S]*\bpositive-first recovery\b[\s\S]*\bspecific CTAs\b/i,
  },
  {
    name: 'institutional-corporate-lane',
    pattern: /\binstitutional corporate copy\b[\s\S]*formal 합니다\/습니다[\s\S]*\bproof before emotion\b[\s\S]*\bfuture-facing continuity\b/i,
  },
  {
    name: 'style-source-safety',
    pattern: /\bstyle-analysis inputs only\b[\s\S]*\bcopy source passages\b[\s\S]*\bofficial affiliation\b/i,
  },
  { name: 'plain-specific-claims', pattern: /\bplain specific claims\b.*\bconcrete nouns and verbs\b/i },
  { name: 'source-backed-user-context', pattern: /\bsource-backed details\b.*\buser(?:'s)? context\b/i },
  { name: 'anti-slop-self-audit', pattern: /\bself-audit\b.*\btemplate openings\b/i },
  { name: 'avoid-ai-writing-pattern-checks', pattern: /\bavoid-ai-writing\b.*\bpattern checks?\b/i },
  {
    name: 'detectors-not-authorship-verdicts',
    pattern: /\bAI-writing detectors\b[\s\S]*\btruth\b[\s\S]*\baccuse an author\b/i,
  },
  { name: 'detectors-advisory-only', pattern: /\badvisory pattern checks\b/i },
  {
    name: 'meaning-preserving-second-pass',
    pattern: /\bsecond-pass rewrite\b[\s\S]*\bdeterministic cleanup\b[\s\S]*\breread the result for changed meaning\b/i,
  },
]);
const REQUIRED_WORKFLOW_VALIDATIONS = Object.freeze([
  'tmuxPreflight',
  'kimiCodeHomeReady',
  'promptSubmitted',
  'directPlanMode',
  'standardCodingMode',
  'targetWorktreeToolingLinked',
  'workspaceChanged',
  'multiFileWorkspaceChanged',
  'verifierUnchanged',
  'repositorySourceTestChanged',
  'statusLimitedToWorkflowFiles',
  'repositoryTargetedTest',
  'diffContainsSentinel',
  'verificationCommand',
  'agentVerificationObserved',
  'screenEvidence',
  'kimiModelReady',
  'adaptiveOperatorLoop',
  'operatorTrajectory',
]);
const MIN_ULTRAWORK_CACHE_SHARE_PERCENT = 50;
const MAX_ULTRAWORK_CONTEXT_USAGE_PERCENT = 85;
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
  --tui-summary <path|latest-pass>    live TUI launch summary JSON.
  --workflow-summary <path|latest-pass>
                                      live TUI real workflow summary JSON.
  --ultrawork-summary <path|latest-pass>
                                      Optional live TUI Ultrawork activation summary JSON.

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
    workflowSummary: undefined,
    ultraworkSummary: undefined,
  };
  const errors = [];
  const valueOptions = new Set([
    '--criteria',
    '--output-dir',
    '--system-summary',
    '--loop-summary',
    '--tui-summary',
    '--workflow-summary',
    '--ultrawork-summary',
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
    if (options.workflowSummary === undefined) errors.push('Missing required input: --workflow-summary <path>');
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
  if (flag === '--workflow-summary') options.workflowSummary = value;
  if (flag === '--ultrawork-summary') options.ultraworkSummary = value;
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
  };
  const tuiInput = await resolveEvidenceSummaryInput('tuiSummary', options.tuiSummary, outputDir);
  const workflowInput = await resolveEvidenceSummaryInput(
    'workflowSummary',
    options.workflowSummary,
    outputDir,
  );
  const ultraworkInput =
    options.ultraworkSummary === undefined
      ? undefined
      : await resolveEvidenceSummaryInput('ultraworkSummary', options.ultraworkSummary, outputDir);
  evidenceInputs.tuiSummary = tuiInput.path;
  evidenceInputs.workflowSummary = workflowInput.path;
  if (ultraworkInput !== undefined) evidenceInputs.ultraworkSummary = ultraworkInput.path;
  const baselineSelection = await selectBaselineSotaSummary(options, outputDir);
  const inputs = { ...evidenceInputs };
  if (baselineSelection !== undefined) inputs.baselineSotaSummary = baselineSelection.path;
  const systemSummary = await readJsonRequired(evidenceInputs.systemSummary, 'bench-system summary');
  const loopSummary = await readJsonRequired(evidenceInputs.loopSummary, 'bench-system-loop summary');
  const tuiSummary = await readJsonRequired(evidenceInputs.tuiSummary, 'live TUI summary');
  const workflowSummary = await readJsonRequired(
    evidenceInputs.workflowSummary,
    'live TUI real workflow summary',
  );
  const ultraworkSummary =
    evidenceInputs.ultraworkSummary === undefined
      ? undefined
      : await readJsonRequired(evidenceInputs.ultraworkSummary, 'live TUI Ultrawork summary');

  const tuiGate = await evaluateTuiGate(tuiSummary);
  const workflowGate = await evaluateWorkflowGate(workflowSummary);
  const ultraworkGate =
    ultraworkSummary === undefined ? undefined : await evaluateUltraworkGate(ultraworkSummary);
  const gates = [
    evaluateSystemGate(systemSummary),
    evaluateLoopGate(loopSummary),
    tuiGate,
    workflowGate,
    ...(ultraworkGate === undefined ? [] : [ultraworkGate]),
    evaluateBudgetGate(systemSummary, budgets),
    await evaluateNoWebUiSurfaceGate(evidenceInputs),
    await evaluateKnowledgeMapContractGate(),
    await evaluateSecretScanGate(inputs, criteriaPath),
    await evaluateCleanupReceiptGate(evidenceInputs, options.requireCleanupReceipt),
  ];
  const tuiUxDelta =
    baselineSelection === undefined
      ? undefined
      : evaluateTuiUxDeltaGate(baselineSelection.summary, tuiGate.observed?.uxFriction);
  if (tuiUxDelta !== undefined) gates.push(tuiUxDelta);
  const loopScorecard = buildLoopScorecard(criteria, {
    loopGate: gates.find((gate) => gate.name === 'bounded-loop-best-score'),
    systemGate: gates.find((gate) => gate.name === 'system-score-pass-rate'),
    tuiGate,
    workflowGate,
    ultraworkGate,
    budgetGate: gates.find((gate) => gate.name === 'system-budget'),
    cleanupGate: gates.find((gate) => gate.name === 'cleanup-receipt-presence'),
    noWebGate: gates.find((gate) => gate.name === 'no-web-ui-success-surface'),
    secretGate: gates.find((gate) => gate.name === 'no-secret-like-evidence'),
    tuiUxDelta,
  });
  gates.push(
    evaluateLoopScoreGate(loopScorecard),
    evaluateXpDodHarnessGate(loopScorecard),
    await evaluateHumanWritingHarnessGate(loopScorecard),
  );
  const tuiNextActions = recommendTuiNextActions(tuiGate, tuiUxDelta, workflowGate, ultraworkGate);
  const status = gates.every((gate) => gate.status === 'PASS' || gate.required === false) ? 'PASS' : 'FAIL';
  const passReason =
    ultraworkGate === undefined
      ? `All required SOTA gates passed against local bench, live TUI launch, real workflow artifacts, and loop score ${loopScorecard.score}/${loopScorecard.maxScore}.`
      : `All required SOTA gates passed against local bench, live TUI launch, real workflow, Ultrawork artifacts, and loop score ${loopScorecard.score}/${loopScorecard.maxScore}.`;
  return {
    schemaVersion: 1,
    gate: 'super-kimi-agent-sota-gate',
    runId,
    status,
    reason:
      status === 'PASS'
        ? passReason
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
    inputSelections: {
      tuiSummary: tuiInput.selection,
      workflowSummary: workflowInput.selection,
      ultraworkSummary: ultraworkInput?.selection,
    },
    tuiUxFriction: tuiGate.observed?.uxFriction,
    tuiWorkflowProof: workflowGate.observed,
    tuiUltraworkProof: ultraworkGate?.observed,
    tuiUxDelta: tuiUxDelta?.observed,
    loopScorecard,
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

function buildLoopScorecard(criteria, evidence) {
  const rubric = normalizeLoopScoreRubric(criteria.loopScoreRubric);
  const dimensions = [
    buildLoopScoreDimension(rubric, 'vibe-coder-ux', [
      {
        name: 'live TUI scenario coverage',
        units: 10,
        pass: gatePass(evidence.tuiGate),
        evidence: gateEvidence(evidence.tuiGate),
      },
      {
        name: 'UX friction threshold',
        units: 6,
        pass: evidence.tuiGate?.observed?.uxFriction?.status === 'PASS',
        evidence: {
          score: evidence.tuiGate?.observed?.uxFriction?.score,
          threshold: evidence.tuiGate?.observed?.uxFriction?.threshold,
          durationMs: evidence.tuiGate?.observed?.uxFriction?.durationMs,
        },
      },
      {
        name: 'UX no-regression baseline',
        units: 4,
        pass:
          evidence.tuiUxDelta === undefined
            ? evidence.tuiGate?.observed?.uxFriction?.status === 'PASS'
            : gatePass(evidence.tuiUxDelta),
        evidence:
          evidence.tuiUxDelta?.observed ?? {
            verdict: 'not-compared',
            currentScore: evidence.tuiGate?.observed?.uxFriction?.score,
          },
      },
    ]),
    buildLoopScoreDimension(rubric, 'autonomy-auto-activation', [
      {
        name: 'bounded improvement loop',
        units: 5,
        pass: gatePass(evidence.loopGate),
        evidence: gateEvidence(evidence.loopGate),
      },
      {
        name: 'Ultrawork auto activation workflow',
        units: 10,
        pass: ultraworkActivationPass(evidence.ultraworkGate),
        evidence: gateEvidence(evidence.ultraworkGate),
      },
    ]),
    buildLoopScoreDimension(rubric, 'verification-eyes-hands', [
      {
        name: 'live TUI screen and input evidence',
        units: 5,
        pass: gatePass(evidence.tuiGate),
        evidence: gateEvidence(evidence.tuiGate),
      },
      {
        name: 'real workflow source/test proof',
        units: 5,
        pass: gatePass(evidence.workflowGate),
        evidence: gateEvidence(evidence.workflowGate),
      },
      {
        name: 'cleanup receipts',
        units: 3,
        pass: gatePass(evidence.cleanupGate),
        evidence: gateEvidence(evidence.cleanupGate),
      },
      {
        name: 'safe evidence boundaries',
        units: 2,
        pass: gatePass(evidence.noWebGate) && gatePass(evidence.secretGate),
        evidence: {
          noWebUiSurface: gateStatus(evidence.noWebGate),
          secretScan: gateStatus(evidence.secretGate),
        },
      },
    ]),
    buildLoopScoreDimension(rubric, 'tui-state-expression', [
      {
        name: 'status readiness and XP/DoD signals',
        units: 7,
        pass: statusScenarioHasReadinessSignals(evidence.tuiGate),
        evidence: statusScenarioEvidence(evidence.tuiGate),
      },
      {
        name: 'complete live TUI scenario observations',
        units: 5,
        pass: allTuiScenariosPass(evidence.tuiGate),
        evidence: {
          required: REQUIRED_TUI_SCENARIOS.length,
          passing: countPassingTuiScenarios(evidence.tuiGate),
        },
      },
      {
        name: 'ordered input traces',
        units: 3,
        pass: allRequiredTuiInputsPass(evidence.tuiGate),
        evidence: {
          required: REQUIRED_TUI_INPUT_SCENARIOS.length,
          passing: countPassingRequiredTuiInputs(evidence.tuiGate),
        },
      },
    ]),
    buildLoopScoreDimension(rubric, 'coding-success-bug-prevention', [
      {
        name: 'system benchmark pass rate',
        units: 5,
        pass: gatePass(evidence.systemGate),
        evidence: gateEvidence(evidence.systemGate),
      },
      {
        name: 'real workflow verification and targeted test',
        units: 5,
        pass: workflowCodeProofPass(evidence.workflowGate),
        evidence: workflowCodeEvidence(evidence.workflowGate),
      },
      {
        name: 'Ultrawork verification and targeted test',
        units: 5,
        pass: workflowCodeProofPass(evidence.ultraworkGate),
        evidence: workflowCodeEvidence(evidence.ultraworkGate),
      },
    ]),
    buildLoopScoreDimension(rubric, 'speed-token-cache-efficiency', [
      {
        name: 'system budget gate',
        units: 7,
        pass: gatePass(evidence.budgetGate),
        evidence: gateEvidence(evidence.budgetGate),
      },
      {
        name: 'TUI duration and command friction',
        units: 3,
        pass: tuiDurationAndCommandFrictionPass(evidence.tuiGate),
        evidence: evidence.tuiGate?.observed?.uxFriction,
      },
    ]),
    buildLoopScoreDimension(rubric, 'stuck-loop-stability', [
      {
        name: 'bounded loop guardrails',
        units: 4,
        pass: gatePass(evidence.loopGate),
        evidence: gateEvidence(evidence.loopGate),
      },
      {
        name: 'real workflow adaptive operator loop',
        units: 3,
        pass: workflowStabilityPass(evidence.workflowGate),
        evidence: workflowStabilityEvidence(evidence.workflowGate),
      },
      {
        name: 'Ultrawork adaptive operator loop',
        units: 3,
        pass: workflowStabilityPass(evidence.ultraworkGate),
        evidence: workflowStabilityEvidence(evidence.ultraworkGate),
      },
    ]),
  ];
  const score = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const maxScore = dimensions.reduce((sum, dimension) => sum + dimension.maxPoints, 0);
  return {
    status: score >= rubric.threshold ? 'PASS' : 'FAIL',
    score,
    maxScore,
    threshold: rubric.threshold,
    principle: rubric.principle,
    dimensions,
    definitionOfDone: rubric.definitionOfDone,
    xpLite: rubric.xpLite,
    humanWriting: rubric.humanWriting,
  };
}

function normalizeLoopScoreRubric(config) {
  const configuredDimensions = Array.isArray(config?.dimensions) ? config.dimensions : [];
  const byId = new Map(configuredDimensions.map((dimension) => [dimension?.id, dimension]));
  return {
    threshold:
      typeof config?.threshold === 'number' && Number.isFinite(config.threshold)
        ? config.threshold
        : DEFAULT_LOOP_SCORE_THRESHOLD,
    principle:
      typeof config?.principle === 'string'
        ? config.principle
        : 'XP-lite and Definition of Done are required harness-level loop design inputs.',
    dimensions: DEFAULT_LOOP_SCORE_RUBRIC.map((defaults) => {
      const override = byId.get(defaults.id);
      const maxPoints =
        typeof override?.maxPoints === 'number' && Number.isFinite(override.maxPoints)
          ? override.maxPoints
          : defaults.maxPoints;
      return {
        id: defaults.id,
        label: typeof override?.label === 'string' ? override.label : defaults.label,
        maxPoints,
      };
    }),
    definitionOfDone: Array.isArray(config?.definitionOfDone) ? config.definitionOfDone : [],
    xpLite: Array.isArray(config?.xpLite) ? config.xpLite : [],
    humanWriting: Array.isArray(config?.humanWriting) ? config.humanWriting : [],
  };
}

function buildLoopScoreDimension(rubric, id, specs) {
  const dimension = rubric.dimensions.find((entry) => entry.id === id);
  if (dimension === undefined) {
    throw new Error(`Missing loop score dimension in rubric: ${id}`);
  }
  const parts = buildLoopScoreParts(dimension.maxPoints, specs);
  const score = parts.reduce((sum, part) => sum + part.points, 0);
  return {
    id,
    label: dimension.label,
    status: score === dimension.maxPoints ? 'PASS' : score > 0 ? 'PARTIAL' : 'FAIL',
    score,
    maxPoints: dimension.maxPoints,
    parts,
  };
}

function buildLoopScoreParts(maxPoints, specs) {
  const totalUnits = specs.reduce((sum, spec) => sum + spec.units, 0);
  let allocated = 0;
  return specs.map((spec, index) => {
    const partMax =
      index === specs.length - 1 ? maxPoints - allocated : Math.round((maxPoints * spec.units) / totalUnits);
    allocated += partMax;
    return {
      name: spec.name,
      status: spec.pass ? 'PASS' : 'MISS',
      points: spec.pass ? partMax : 0,
      maxPoints: partMax,
      evidence: spec.evidence,
    };
  });
}

function evaluateLoopScoreGate(scorecard) {
  return {
    name: 'super-kimi-loop-score',
    status: scorecard.status,
    required: true,
    reason:
      scorecard.status === 'PASS'
        ? `Super Kimi loop score ${scorecard.score}/${scorecard.maxScore} meets threshold ${scorecard.threshold}.`
        : `Super Kimi loop score ${scorecard.score}/${scorecard.maxScore} is below threshold ${scorecard.threshold}.`,
    observed: {
      score: scorecard.score,
      maxScore: scorecard.maxScore,
      threshold: scorecard.threshold,
      dimensions: scorecard.dimensions.map((dimension) => ({
        id: dimension.id,
        status: dimension.status,
        score: dimension.score,
        maxPoints: dimension.maxPoints,
      })),
    },
  };
}

function evaluateXpDodHarnessGate(scorecard) {
  const missingXpLite = missingContractTopics(scorecard.xpLite, REQUIRED_XP_LITE_CONTRACTS);
  const missingDefinitionOfDone = missingContractTopics(
    scorecard.definitionOfDone,
    REQUIRED_DEFINITION_OF_DONE_CONTRACTS,
  );
  const principle = typeof scorecard.principle === 'string' ? scorecard.principle : '';
  const principleMissing =
    /XP-lite/i.test(principle) && /Definition of Done/i.test(principle) && /harness-level/i.test(principle)
      ? []
      : ['harness-level-principle'];
  const missing = [...principleMissing, ...missingXpLite, ...missingDefinitionOfDone];
  return {
    name: 'xp-dod-harness-contract',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      missing.length === 0
        ? 'XP-lite and Definition of Done are enforced as harness-level SOTA gate inputs.'
        : `XP-lite/Definition of Done harness contract is missing: ${missing.join(', ')}.`,
    observed: {
      principle,
      xpLiteCount: Array.isArray(scorecard.xpLite) ? scorecard.xpLite.length : 0,
      definitionOfDoneCount: Array.isArray(scorecard.definitionOfDone)
        ? scorecard.definitionOfDone.length
        : 0,
      missingXpLite,
      missingDefinitionOfDone,
      missingPrinciple: principleMissing,
    },
  };
}

async function evaluateHumanWritingHarnessGate(scorecard) {
  const contractPath = path.resolve(ULTRAWORK_CONTRACT_PATH);
  const contractArtifact = await fileStatus(contractPath);
  const failures = [];
  let missingContract = REQUIRED_HUMAN_WRITING_CONTRACTS.map((topic) => topic.name);
  if (!contractArtifact.exists || contractArtifact.bytes === 0) {
    failures.push(`missing Ultrawork contract: ${ULTRAWORK_CONTRACT_PATH}`);
  } else {
    const contract = await readFile(contractPath, 'utf8');
    missingContract = missingContractTopics([contract], REQUIRED_HUMAN_WRITING_CONTRACTS);
    if (missingContract.length > 0) {
      failures.push(`Ultrawork contract is missing human-writing topics: ${missingContract.join(', ')}`);
    }
  }
  const missingRubric = missingContractTopics(scorecard.humanWriting, REQUIRED_HUMAN_WRITING_CONTRACTS);
  if (missingRubric.length > 0) {
    failures.push(`SOTA rubric is missing human-writing topics: ${missingRubric.join(', ')}`);
  }
  return {
    name: 'human-writing-anti-slop-contract',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'Human-writing anti-slop guidance is enforced as a harness-level output quality contract.'
        : failures.join('; '),
    observed: {
      contractPath,
      contractBytes: contractArtifact.bytes,
      rubricCount: Array.isArray(scorecard.humanWriting) ? scorecard.humanWriting.length : 0,
      missingContract,
      missingRubric,
    },
  };
}

function missingContractTopics(items, requiredTopics) {
  const text = Array.isArray(items) ? items.join('\n') : '';
  return requiredTopics
    .filter((topic) => !topic.pattern.test(text))
    .map((topic) => topic.name);
}

function gatePass(gate) {
  return gate?.status === 'PASS';
}

function gateStatus(gate) {
  return gate?.status ?? 'MISSING';
}

function gateEvidence(gate) {
  return {
    gate: gate?.name,
    status: gateStatus(gate),
    reason: gate?.reason,
  };
}

function statusScenarioEvidence(tuiGate) {
  const scenario = getTuiScenario(tuiGate, 'status');
  return {
    scenario: scenario?.scenario,
    status: scenario?.status,
    screenObservationStatus: scenario?.screenObservationStatus,
    signals: scenario?.screenObservationSignals,
  };
}

function statusScenarioHasReadinessSignals(tuiGate) {
  const signals = getTuiScenario(tuiGate, 'status')?.screenObservationSignals;
  return (
    Array.isArray(signals) &&
    ['status-readiness', 'xp-dod-readiness'].every((signal) => signals.includes(signal))
  );
}

function allTuiScenariosPass(tuiGate) {
  const scenarios = tuiScenarios(tuiGate);
  return scenarios.length >= REQUIRED_TUI_SCENARIOS.length && scenarios.every((scenario) => scenario.status === 'PASS');
}

function countPassingTuiScenarios(tuiGate) {
  return tuiScenarios(tuiGate).filter((scenario) => scenario.status === 'PASS').length;
}

function allRequiredTuiInputsPass(tuiGate) {
  return REQUIRED_TUI_INPUT_SCENARIOS.every((scenario) => {
    const entry = getTuiScenario(tuiGate, scenario);
    return entry?.inputTraceStatus === 'PASS';
  });
}

function countPassingRequiredTuiInputs(tuiGate) {
  return REQUIRED_TUI_INPUT_SCENARIOS.filter((scenario) => {
    const entry = getTuiScenario(tuiGate, scenario);
    return entry?.inputTraceStatus === 'PASS';
  }).length;
}

function getTuiScenario(tuiGate, scenario) {
  return tuiScenarios(tuiGate).find((entry) => entry.scenario === scenario);
}

function tuiScenarios(tuiGate) {
  return Array.isArray(tuiGate?.observed?.scenarios) ? tuiGate.observed.scenarios : [];
}

function workflowCodeProofPass(gate) {
  const workspace = gate?.observed?.workspace;
  return (
    gatePass(gate) &&
    workspace?.diffExitCode === 0 &&
    workspace?.verificationExitCode === 0 &&
    workspace?.targetedTestExitCode === 0 &&
    (workspace?.editedFileCount ?? 0) >= 2
  );
}

function workflowCodeEvidence(gate) {
  const workspace = gate?.observed?.workspace;
  return {
    gate: gate?.name,
    status: gateStatus(gate),
    diffExitCode: workspace?.diffExitCode,
    verificationExitCode: workspace?.verificationExitCode,
    targetedTestExitCode: workspace?.targetedTestExitCode,
    editedFileCount: workspace?.editedFileCount,
  };
}

function ultraworkActivationPass(gate) {
  const observed = gate?.observed;
  const questionProgress =
    observed?.questionBypassed === true || (observed?.questionAnswerEvidenceCount ?? 0) > 0;
  return (
    gatePass(gate) &&
    (observed?.activationEvidenceCount ?? 0) > 0 &&
    (observed?.interviewEvidenceCount ?? 0) > 0 &&
    questionProgress &&
    (observed?.postQuestionProgressEvidenceCount ?? 0) > 0 &&
    (observed?.questionToolErrorEvidenceCount ?? 0) === 0 &&
    (observed?.policyConflictEvidenceCount ?? 0) === 0
  );
}

function tuiDurationAndCommandFrictionPass(tuiGate) {
  const friction = tuiGate?.observed?.uxFriction;
  return (
    friction?.status === 'PASS' &&
    typeof friction.durationMs === 'number' &&
    friction.durationMs <= TUI_TARGET_DURATION_MS &&
    friction.dimensions?.commandFailureCount === 0 &&
    friction.dimensions?.commandTimeoutCount === 0
  );
}

function workflowStabilityPass(gate) {
  const observed = gate?.observed;
  const trajectory = Array.isArray(observed?.trajectorySteps) ? observed.trajectorySteps : [];
  return (
    gatePass(gate) &&
    (observed?.adaptiveObservationCount ?? 0) > 0 &&
    trajectory.length > 0 &&
    trajectory.every((step) => step.status === 'PASS')
  );
}

function workflowStabilityEvidence(gate) {
  const observed = gate?.observed;
  return {
    gate: gate?.name,
    status: gateStatus(gate),
    adaptiveObservationCount: observed?.adaptiveObservationCount,
    adaptiveInterventionsAttempted: observed?.adaptiveInterventionsAttempted,
    trajectorySteps: observed?.trajectorySteps,
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

async function resolveEvidenceSummaryInput(kind, value, outputDir) {
  if (value !== LATEST_PASS_INPUT) {
    return {
      path: path.resolve(value),
      selection: {
        source: 'explicit-path',
        path: path.resolve(value),
      },
    };
  }

  const selection = await findLatestPassingEvidenceSummary(kind, path.resolve(DEFAULT_EVIDENCE_ROOT), outputDir);
  if (selection === undefined) {
    throw new Error(`No latest passing ${kind} evidence summary found under ${DEFAULT_EVIDENCE_ROOT}`);
  }
  return {
    path: selection.path,
    selection,
  };
}

async function findLatestPassingEvidenceSummary(kind, evidenceRoot, outputDir) {
  const candidates = await findEvidenceSummaryFiles(evidenceRoot, {
    excludeDir: outputDir,
    limit: AUTO_BASELINE_SCAN_LIMIT,
    kind,
  });
  let selected;
  for (const candidate of candidates) {
    const summary = await readJsonIfFile(candidate.path);
    if (!isUsableEvidenceSummary(kind, summary)) continue;
    const completedAtMs = evidenceSummaryCompletedAtMs(summary, candidate.modifiedAt);
    const next = {
      source: 'auto-latest-pass',
      kind,
      path: candidate.path,
      reason: latestEvidenceReason(kind),
      phase: summary.phase,
      summaryStatus: summary.status,
      modifiedAt: candidate.modifiedAt,
      completedAt: summary.completedAt,
      completedAtMs,
    };
    if (
      selected === undefined ||
      next.completedAtMs > selected.completedAtMs ||
      (next.completedAtMs === selected.completedAtMs && next.modifiedAt > selected.modifiedAt)
    ) {
      selected = next;
    }
  }
  return selected;
}

async function findEvidenceSummaryFiles(rootDir, options) {
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
      if (!entry.isFile() || !isEvidenceSummaryCandidate(options.kind, relativePath)) continue;
      const info = await fileStatOrUndefined(absolutePath);
      if (info === undefined) continue;
      files.push({ path: absolutePath, modifiedAt: info.mtimeMs });
      if (files.length >= options.limit) break;
    }
  }
  return files.toSorted((left, right) => right.modifiedAt - left.modifiedAt);
}

function isEvidenceSummaryCandidate(kind, relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (kind === 'tuiSummary') {
    return normalized.endsWith('/tui-launch.json') || normalized.endsWith('/tui/summary.json');
  }
  if (kind === 'workflowSummary') return normalized.endsWith('/tui-real-workflow.json');
  if (kind === 'ultraworkSummary') return normalized.endsWith('/tui-ultrawork-workflow.json');
  return false;
}

function isUsableEvidenceSummary(kind, summary) {
  if (kind === 'tuiSummary') return isUsableTuiSummary(summary);
  if (kind === 'workflowSummary') return isUsableWorkflowSummary(summary);
  if (kind === 'ultraworkSummary') return isUsableUltraworkSummary(summary);
  return false;
}

function isUsableTuiSummary(summary) {
  if (summary?.phase !== 'tui-launch' || summary.status !== 'PASS') return false;
  if (!Array.isArray(summary.captures) || !Array.isArray(summary.inputTraces)) return false;
  const captures = new Map(summary.captures.map((capture) => [capture.scenario, capture]));
  const traces = new Map(summary.inputTraces.map((trace) => [trace.scenario, trace]));
  return (
    REQUIRED_TUI_SCENARIOS.every((scenario) => captures.get(scenario)?.status === 'PASS') &&
    REQUIRED_TUI_INPUT_SCENARIOS.every((scenario) => traces.get(scenario)?.status === 'PASS')
  );
}

function isUsableWorkflowSummary(summary) {
  if (summary?.phase !== 'tui-real-workflow' || summary.status !== 'PASS') return false;
  if (summary.kimiCodeHomeMode !== 'real-user-opt-in') return false;
  if (REQUIRED_WORKFLOW_VALIDATIONS.some((name) => summary.validations?.[name]?.status !== 'PASS')) {
    return false;
  }
  if (!Array.isArray(summary.workflow?.wait?.agentVerificationEvidence)) return false;
  if (summary.workflow.wait.agentVerificationEvidence.length === 0) return false;
  if (!Array.isArray(summary.captures) || !Array.isArray(summary.inputTraces)) return false;
  if (!Array.isArray(summary.workspace?.editFiles) || summary.workspace.editFiles.length < 2) return false;
  if (summary.workspace?.editedFileCount < 2) return false;
  if (summary.workspace?.diffExitCode !== 0) return false;
  if (summary.workspace?.verificationExitCode !== 0) return false;
  return summary.workspace?.targetedTestExitCode === 0;
}

function isUsableUltraworkSummary(summary) {
  return isCompleteUltraworkEvidenceSummary(summary);
}

function latestEvidenceReason(kind) {
  if (kind === 'tuiSummary') {
    return 'Selected the latest passing live TUI launch summary with required screen and input traces.';
  }
  if (kind === 'workflowSummary') {
    return 'Selected the latest passing live TUI real workflow summary with source/test, clean-scope, and agent verification evidence.';
  }
  return 'Selected the latest passing live TUI Ultrawork workflow summary with activation, interview, clean-scope, and verification evidence.';
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

async function evaluateWorkflowGate(summary) {
  const failures = [];
  if (summary.phase !== 'tui-real-workflow') {
    failures.push(`workflow phase is ${String(summary.phase)}`);
  }
  if (summary.status !== 'PASS') failures.push(`workflow status is ${String(summary.status)}`);
  if (summary.kimiCodeHomeMode !== 'real-user-opt-in') {
    failures.push(`KIMI_CODE_HOME mode is ${String(summary.kimiCodeHomeMode)}`);
  }

  const validationStatuses = {};
  for (const name of REQUIRED_WORKFLOW_VALIDATIONS) {
    const status = summary.validations?.[name]?.status;
    validationStatuses[name] = status;
    if (status !== 'PASS') failures.push(`${name} validation is ${String(status)}`);
  }

  const workflowWait = summary.workflow?.wait;
  if (workflowWait?.status !== 'PASS') failures.push(`workflow wait status is ${String(workflowWait?.status)}`);
  if (!Array.isArray(workflowWait?.agentVerificationEvidence) || workflowWait.agentVerificationEvidence.length === 0) {
    failures.push('agent-run verification evidence is missing from workflow wait');
  }
  if (summary.workspace?.diffExitCode !== 0) {
    failures.push(`workflow diff exit code is ${String(summary.workspace?.diffExitCode)}`);
  }
  if (summary.workspace?.verificationExitCode !== 0) {
    failures.push(`workflow verification exit code is ${String(summary.workspace?.verificationExitCode)}`);
  }
  if (summary.workspace?.targetedTestExitCode !== 0) {
    failures.push(`workflow targeted test exit code is ${String(summary.workspace?.targetedTestExitCode)}`);
  }
  if (!Array.isArray(summary.workspace?.editFiles) || summary.workspace.editFiles.length < 2) {
    failures.push('workflow edit file list must include at least two files');
  }
  if (summary.workspace?.editedFileCount < 2) {
    failures.push(`workflow edited file count is ${String(summary.workspace?.editedFileCount)}`);
  }
  const failedTrajectorySteps = Array.isArray(summary.operatorTrajectory?.steps)
    ? summary.operatorTrajectory.steps.filter((step) => step.status !== 'PASS')
    : [];
  if (!Array.isArray(summary.operatorTrajectory?.steps) || failedTrajectorySteps.length > 0) {
    failures.push('operator trajectory has failing or missing steps');
  }

  const captureResults = await validateWorkflowCaptures(summary);
  for (const capture of captureResults.filter((result) => result.status !== 'PASS')) {
    failures.push(`workflow capture ${capture.scenario} is ${capture.status}`);
  }
  const inputResults = validateWorkflowInputTraces(summary);
  for (const trace of inputResults.filter((result) => result.status !== 'PASS')) {
    failures.push(`workflow input ${trace.scenario} is ${trace.status}`);
  }

  return {
    name: 'real-tui-workflow-proof',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'Real TUI workflow proof passed with direct /plan off, standard /auto mode, agent-run verification, diff, and cleanup evidence.'
        : failures.join('; '),
    observed: {
      phase: summary.phase,
      status: summary.status,
      kimiCodeHomeMode: summary.kimiCodeHomeMode,
      validationStatuses,
      workflowWaitStatus: workflowWait?.status,
      agentVerificationEvidenceCount: Array.isArray(workflowWait?.agentVerificationEvidence)
        ? workflowWait.agentVerificationEvidence.length
        : 0,
      adaptiveObservationCount: summary.validations?.adaptiveOperatorLoop?.observationCount,
      adaptiveInterventionsAttempted: summary.validations?.adaptiveOperatorLoop?.interventionsAttempted,
      trajectorySteps: Array.isArray(summary.operatorTrajectory?.steps)
        ? summary.operatorTrajectory.steps.map((step) => ({
            name: step.name,
            status: step.status,
          }))
        : [],
      captureResults,
      inputResults,
      workspace: {
        diffExitCode: summary.workspace?.diffExitCode,
        verificationExitCode: summary.workspace?.verificationExitCode,
        diffPath: summary.workspace?.diffPath,
        editedFileCount: summary.workspace?.editedFileCount,
        editFiles: summary.workspace?.editFiles,
        fileState: summary.workspace?.fileState,
        targetedTestCommand: summary.workspace?.targetedTestCommand,
        targetedTestExitCode: summary.workspace?.targetedTestExitCode,
      },
    },
  };
}

async function evaluateUltraworkGate(summary) {
  const failures = [];
  if (summary.phase !== 'tui-ultrawork-workflow') {
    failures.push(`Ultrawork phase is ${String(summary.phase)}`);
  }
  if (summary.status !== 'PASS') failures.push(`Ultrawork status is ${String(summary.status)}`);
  if (summary.kimiCodeHomeMode !== 'real-user-opt-in') {
    failures.push(`KIMI_CODE_HOME mode is ${String(summary.kimiCodeHomeMode)}`);
  }

  const validationStatuses = {};
  for (const name of REQUIRED_ULTRAWORK_VALIDATIONS) {
    const status = summary.validations?.[name]?.status;
    validationStatuses[name] = status;
    if (status !== 'PASS') failures.push(`${name} validation is ${String(status)}`);
  }
  const usageMetrics = summary.validations?.usageTelemetryVisible?.metrics;
  const missingUsageMetrics = missingUltraworkUsageMetricNames(usageMetrics);
  if (missingUsageMetrics.length > 0) {
    failures.push(`Ultrawork usage telemetry metrics are missing: ${missingUsageMetrics.join(', ')}`);
  }
  const usageEfficiency = evaluateUltraworkUsageEfficiency(usageMetrics, missingUsageMetrics);
  failures.push(...usageEfficiency.failures);

  const workflowWait = summary.workflow?.wait;
  if (workflowWait?.status !== 'PASS') {
    failures.push(`Ultrawork wait status is ${String(workflowWait?.status)}`);
  }
  if (!Array.isArray(workflowWait?.activationEvidence) || workflowWait.activationEvidence.length === 0) {
    failures.push('Ultrawork activation evidence is missing from workflow wait');
  }
  if (!Array.isArray(workflowWait?.interviewEvidence) || workflowWait.interviewEvidence.length === 0) {
    failures.push('Ultra Plan interview evidence is missing from workflow wait');
  }
  const questionBypassed =
    summary.validations?.questionAnswered?.status === 'PASS' &&
    summary.validations.questionAnswered.optional === true;
  if (
    !questionBypassed &&
    (!Array.isArray(workflowWait?.questionAnswerEvidence) ||
      workflowWait.questionAnswerEvidence.length === 0)
  ) {
    failures.push('Ultrawork question-answer evidence is missing from workflow wait');
  }
  if (
    !Array.isArray(workflowWait?.postQuestionProgressEvidence) ||
    workflowWait.postQuestionProgressEvidence.length === 0
  ) {
    failures.push('Ultrawork post-question progress evidence is missing from workflow wait');
  }
  if (
    Array.isArray(workflowWait?.questionToolErrorEvidence) &&
    workflowWait.questionToolErrorEvidence.length > 0
  ) {
    failures.push('AskUserQuestion tool contract error evidence is present');
  }
  if (!Array.isArray(workflowWait?.agentVerificationEvidence) || workflowWait.agentVerificationEvidence.length === 0) {
    failures.push('agent-run verification evidence is missing from Ultrawork workflow wait');
  }
  if (summary.workspace?.diffExitCode !== 0) {
    failures.push(`Ultrawork workflow diff exit code is ${String(summary.workspace?.diffExitCode)}`);
  }
  if (summary.workspace?.verificationExitCode !== 0) {
    failures.push(
      `Ultrawork workflow verification exit code is ${String(summary.workspace?.verificationExitCode)}`,
    );
  }
  if (summary.workspace?.targetedTestExitCode !== 0) {
    failures.push(
      `Ultrawork workflow targeted test exit code is ${String(summary.workspace?.targetedTestExitCode)}`,
    );
  }
  if (!Array.isArray(summary.workspace?.editFiles) || summary.workspace.editFiles.length < 2) {
    failures.push('Ultrawork workflow edit file list must include at least two files');
  }
  if (summary.workspace?.editedFileCount < 2) {
    failures.push(
      `Ultrawork workflow edited file count is ${String(summary.workspace?.editedFileCount)}`,
    );
  }
  const failedTrajectorySteps = Array.isArray(summary.operatorTrajectory?.steps)
    ? summary.operatorTrajectory.steps.filter((step) => step.status !== 'PASS')
    : [];
  if (!Array.isArray(summary.operatorTrajectory?.steps) || failedTrajectorySteps.length > 0) {
    failures.push('Ultrawork operator trajectory has failing or missing steps');
  }

  const captureResults = await validateUltraworkCaptures(summary);
  for (const capture of captureResults.filter((result) => result.status !== 'PASS')) {
    failures.push(`Ultrawork capture ${capture.scenario} is ${capture.status}`);
  }
  const inputResults = validateUltraworkInputTraces(summary);
  for (const trace of inputResults.filter((result) => result.status !== 'PASS')) {
    failures.push(`Ultrawork input ${trace.scenario} is ${trace.status}`);
  }

  return {
    name: 'live-tui-ultrawork-source-test-proof',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? ultraworkGatePassReason(questionBypassed)
        : failures.join('; '),
    observed: {
      phase: summary.phase,
      status: summary.status,
      kimiCodeHomeMode: summary.kimiCodeHomeMode,
      validationStatuses,
      workflowWaitStatus: workflowWait?.status,
      activationEvidenceCount: Array.isArray(workflowWait?.activationEvidence)
        ? workflowWait.activationEvidence.length
        : 0,
      interviewEvidenceCount: Array.isArray(workflowWait?.interviewEvidence)
        ? workflowWait.interviewEvidence.length
        : 0,
      questionEvidenceCount: Array.isArray(workflowWait?.questionEvidence)
        ? workflowWait.questionEvidence.length
        : 0,
      questionAnswerEvidenceCount: Array.isArray(workflowWait?.questionAnswerEvidence)
        ? workflowWait.questionAnswerEvidence.length
        : 0,
      questionBypassed,
      postQuestionProgressEvidenceCount: Array.isArray(workflowWait?.postQuestionProgressEvidence)
        ? workflowWait.postQuestionProgressEvidence.length
        : 0,
      agentVerificationEvidenceCount: Array.isArray(workflowWait?.agentVerificationEvidence)
        ? workflowWait.agentVerificationEvidence.length
        : 0,
      questionToolErrorEvidenceCount: Array.isArray(workflowWait?.questionToolErrorEvidence)
        ? workflowWait.questionToolErrorEvidence.length
        : 0,
      policyConflictEvidenceCount: Array.isArray(workflowWait?.policyConflictEvidence)
        ? workflowWait.policyConflictEvidence.length
        : 0,
      adaptiveObservationCount: summary.validations?.adaptiveOperatorLoop?.observationCount,
      adaptiveInterventionsAttempted: summary.validations?.adaptiveOperatorLoop?.interventionsAttempted,
      usageTelemetryStatus: summary.validations?.usageTelemetryVisible?.status,
      usageTelemetryMetrics: usageMetrics,
      usageTelemetryMissingMetrics: missingUsageMetrics,
      usageTelemetryEfficiency: usageEfficiency.observed,
      trajectorySteps: Array.isArray(summary.operatorTrajectory?.steps)
        ? summary.operatorTrajectory.steps.map((step) => ({
            name: step.name,
            status: step.status,
          }))
        : [],
      captureResults,
      inputResults,
      workspace: {
        diffExitCode: summary.workspace?.diffExitCode,
        verificationExitCode: summary.workspace?.verificationExitCode,
        diffPath: summary.workspace?.diffPath,
        editedFileCount: summary.workspace?.editedFileCount,
        editFiles: summary.workspace?.editFiles,
        fileState: summary.workspace?.fileState,
        targetedTestCommand: summary.workspace?.targetedTestCommand,
        targetedTestExitCode: summary.workspace?.targetedTestExitCode,
      },
      ultraworkScorecard: summary.evaluation?.scorecard,
    },
  };
}

function ultraworkGatePassReason(questionBypassed) {
  const questionHandling = questionBypassed
    ? 'proceeded without a blocking interview question'
    : 'answered an interview question';
  return `Live TUI Ultrawork auto-activation ${questionHandling}, completed source/test edits, observed agent-run verification, and passed targeted checks without AskUserQuestion contract errors or auto/question policy deadlock.`;
}

function evaluateUltraworkUsageEfficiency(metrics, missingMetrics) {
  if (missingMetrics.length > 0) {
    return {
      failures: [],
      observed: {
        status: 'SKIPPED',
        reason: 'numeric usage telemetry is incomplete',
        requiredCacheSharePercent: MIN_ULTRAWORK_CACHE_SHARE_PERCENT,
        maxContextUsagePercent: MAX_ULTRAWORK_CONTEXT_USAGE_PERCENT,
      },
    };
  }

  const failures = [];
  if (metrics.totalTokensApprox <= 0) {
    failures.push(`Ultrawork total token telemetry is ${String(metrics.totalTokensApprox)}`);
  }
  if (metrics.cacheReadTokensApprox <= 0) {
    failures.push('Ultrawork cache read telemetry did not prove prompt-cache reuse');
  }
  if (metrics.cacheSharePercent < MIN_ULTRAWORK_CACHE_SHARE_PERCENT) {
    failures.push(
      `Ultrawork cache share ${String(metrics.cacheSharePercent)}% is below ${String(MIN_ULTRAWORK_CACHE_SHARE_PERCENT)}%`,
    );
  }
  if (metrics.contextUsagePercent > MAX_ULTRAWORK_CONTEXT_USAGE_PERCENT) {
    failures.push(
      `Ultrawork context usage ${String(metrics.contextUsagePercent)}% exceeds ${String(MAX_ULTRAWORK_CONTEXT_USAGE_PERCENT)}%`,
    );
  }
  if (metrics.remainingContextTokensApprox <= 0) {
    failures.push('Ultrawork remaining context telemetry did not prove usable context headroom');
  }

  return {
    failures,
    observed: {
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      requiredCacheSharePercent: MIN_ULTRAWORK_CACHE_SHARE_PERCENT,
      maxContextUsagePercent: MAX_ULTRAWORK_CONTEXT_USAGE_PERCENT,
      cacheReadTokensApprox: metrics.cacheReadTokensApprox,
      cacheSharePercent: metrics.cacheSharePercent,
      contextUsagePercent: metrics.contextUsagePercent,
      remainingContextTokensApprox: metrics.remainingContextTokensApprox,
    },
  };
}

async function validateUltraworkCaptures(summary) {
  const captures = Array.isArray(summary.captures) ? summary.captures : [];
  const requiredScenarios = [
    'ultrawork-startup',
    'ultrawork-plan-reset',
    'ultrawork-submitted',
    'ultrawork-after-wait',
    'ultrawork-usage',
  ];
  const results = [];
  for (const scenario of requiredScenarios) {
    const capture = captures.find((entry) => entry.scenario === scenario);
    const file = capture?.path;
    const artifact = typeof file === 'string' ? await fileStatus(file) : { exists: false, bytes: 0 };
    results.push({
      scenario,
      status: capture?.status === 'PASS' && artifact.exists && artifact.bytes > 0 ? 'PASS' : 'FAIL',
      path: file,
      bytes: artifact.bytes,
    });
  }
  return results;
}

function validateUltraworkInputTraces(summary) {
  const traces = Array.isArray(summary.inputTraces) ? summary.inputTraces : [];
  const questionBypassed =
    summary.validations?.questionAnswered?.status === 'PASS' &&
    summary.validations.questionAnswered.optional === true;
  const planResetTrace = traces.find((entry) => entry.scenario === 'ultrawork-plan-reset');
  const trace = traces.find((entry) => entry.scenario === 'ultrawork-auto-prompt');
  const usageTrace = traces.find((entry) => entry.scenario === 'ultrawork-usage');
  const questionSubmitTrace = traces.find(
    (entry) =>
      typeof entry.scenario === 'string' &&
      entry.scenario.startsWith('ultrawork-question-submit-'),
  );
  const questionAnswerTrace =
    traces.find(
      (entry) =>
        typeof entry.scenario === 'string' &&
        entry.scenario.startsWith('ultrawork-question-answer-'),
    ) ?? questionSubmitTrace;
  return [
    {
      scenario: 'ultrawork-plan-reset',
      status:
        planResetTrace?.status === 'PASS' &&
        Array.isArray(planResetTrace.keys) &&
        planResetTrace.keys.includes('/plan off')
          ? 'PASS'
          : 'FAIL',
      keys: planResetTrace?.keys,
    },
    {
      scenario: 'ultrawork-auto-prompt',
      status:
        trace?.status === 'PASS' &&
        Array.isArray(trace.keys) &&
        trace.keys.some(
          (key) =>
            typeof key === 'string' &&
            /Ultrawork/i.test(key) &&
            key.includes(TUI_ULTRAWORK_WORKFLOW_GUIDANCE),
        )
          ? 'PASS'
          : 'FAIL',
      keys: trace?.keys,
    },
    {
      scenario: 'ultrawork-question-answer',
      status:
        questionBypassed ||
        (questionAnswerTrace?.status === 'PASS' &&
          Array.isArray(questionAnswerTrace.keys) &&
          (questionAnswerTrace.keys.includes('1') || questionAnswerTrace.keys.includes('Enter')))
          ? 'PASS'
          : 'FAIL',
      keys: questionAnswerTrace?.keys,
    },
    {
      scenario: 'ultrawork-question-submit',
      status:
        questionBypassed ||
        (questionSubmitTrace?.status === 'PASS' &&
          Array.isArray(questionSubmitTrace.keys) &&
          questionSubmitTrace.keys.includes('Enter'))
          ? 'PASS'
          : 'FAIL',
      keys: questionSubmitTrace?.keys,
    },
    {
      scenario: 'ultrawork-usage',
      status:
        usageTrace?.status === 'PASS' &&
        Array.isArray(usageTrace.keys) &&
        usageTrace.keys.includes('/usage') &&
        usageTrace.keys.includes('Enter')
          ? 'PASS'
          : 'FAIL',
      keys: usageTrace?.keys,
    },
  ];
}

async function validateWorkflowCaptures(summary) {
  const captures = Array.isArray(summary.captures) ? summary.captures : [];
  const requiredScenarios = [
    'startup',
    'real-workflow-plan-off',
    'real-workflow-auto-on',
    'real-workflow-submitted',
    'real-workflow-after-wait',
  ];
  const results = [];
  for (const scenario of requiredScenarios) {
    const capture = captures.find((entry) => entry.scenario === scenario);
    const file = capture?.path;
    const artifact = file === undefined ? { exists: false, bytes: 0 } : await fileStatus(file);
    results.push({
      scenario,
      status: capture?.status === 'PASS' && artifact.exists && artifact.bytes > 0 ? 'PASS' : 'FAIL',
      captureStatus: capture?.status,
      path: file,
      bytes: artifact.bytes,
    });
  }
  return results;
}

function validateWorkflowInputTraces(summary) {
  const inputTraces = Array.isArray(summary.inputTraces) ? summary.inputTraces : [];
  const requiredScenarios = ['real-workflow-plan-off', 'real-workflow-auto-on', 'real-workflow-prompt'];
  return requiredScenarios.map((scenario) => {
    const trace = inputTraces.find((entry) => entry.scenario === scenario);
    const steps = Array.isArray(trace?.steps) ? trace.steps : [];
    const failedStep = steps.find((step) => step.exitCode !== 0 || step.timedOut === true);
    return {
      scenario,
      status:
        trace?.status === 'PASS' &&
        steps.length > 0 &&
        Array.isArray(trace.keys) &&
        trace.keys.length > 0 &&
        failedStep === undefined
          ? 'PASS'
          : 'FAIL',
      traceStatus: trace?.status,
      steps: steps.length,
      keys: Array.isArray(trace?.keys) ? trace.keys : [],
    };
  });
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

function recommendTuiNextActions(tuiGate, tuiUxDeltaGate, workflowGate, ultraworkGate) {
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

  if (workflowGate.status !== 'PASS') {
    addAction(
      'repair-real-tui-workflow-proof',
      'The real TUI workflow gate did not prove direct coding, real repository source/test change, screen-state classification, agent-run verification, diff review, and targeted test verification together.',
      workflowGate.observed,
      'node scripts/qa-super-kimi-autonomous.mjs --phase tui-real-workflow --use-real-kimi-home --evidence-root .omo/evidence/<real-workflow-repair>',
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
  if (ultraworkGate === undefined) {
    addAction(
      'add-dedicated-ultrawork-workflow-gate',
      'Direct live TUI workflow evidence passes, but SOTA gate does not yet include a dedicated Ultrawork source/test verification workflow summary.',
      {
        workflowGate: workflowGate.status,
        requiredNextGate: 'ultrawork-source-test-verification-workflow',
      },
      'node scripts/qa-super-kimi-autonomous.mjs --phase tui-ultrawork-workflow --use-real-kimi-home --evidence-root .omo/evidence/<ultrawork-workflow-after>',
    );
  } else if (ultraworkGate.status !== 'PASS') {
    addAction(
      'repair-dedicated-ultrawork-workflow-gate',
      'The dedicated Ultrawork workflow did not prove natural-language auto activation, question answering, bounded source/test edits, agent-run verification, targeted tests, and no auto/question policy deadlock together.',
      ultraworkGate.observed,
      'node scripts/qa-super-kimi-autonomous.mjs --phase tui-ultrawork-workflow --use-real-kimi-home --evidence-root .omo/evidence/<ultrawork-workflow-repair>',
    );
  }

  if (actions.length === 0) {
    addAction(
      'advance-to-ultrawork-ux-performance-loop',
      'Current direct live TUI workflow and dedicated Ultrawork source/test verification evidence pass; the next loop should improve TUI feedback, loop stability, speed, or richer operator control without relaxing this success surface.',
      {
        currentScore: uxFriction?.score,
        deltaVerdict: tuiUxDeltaGate?.observed?.verdict ?? 'not-compared',
        workflowGate: workflowGate.status,
        ultraworkGate: ultraworkGate?.status,
        requiredNextGate: 'ultrawork-ux-performance-or-richer-operator-control',
        agentVerificationEvidenceCount: workflowGate.observed?.agentVerificationEvidenceCount,
        editedFileCount: workflowGate.observed?.workspace?.editedFileCount,
        targetedTestExitCode: workflowGate.observed?.workspace?.targetedTestExitCode,
        requiredOperatorEvidence: [
          'startup screen observation',
          'direct coding mode activation',
          'ordered keyboard prompt submission',
          'submitted/result screen observation',
          'screen-state classification during the run',
          'operator wait/intervention decisions',
          'no plan-mode false-starts',
          'agent-run verification observed in TUI',
          'real repository source/test evidence',
          'workspace diff review',
          'targeted test command',
          'Ultrawork activation marker',
          'Ultra Plan interview evidence',
          'Ultrawork question answer selection input trace',
          'Ultrawork question answer submit input trace',
          'post-question Ultrawork progress evidence',
          'no AskUserQuestion tool contract error',
          'no auto/question policy conflict',
          'Ultrawork source/test edit evidence',
          'Ultrawork targeted test command',
          'Ultrawork agent-run verification observed in TUI',
        ],
        currentTier: 'ultrawork-full-cycle-operator-loop',
        passingScenarios: scenarios
          .filter((scenario) => scenario.status === 'PASS')
          .map((scenario) => scenario.scenario),
      },
      'node scripts/qa-super-kimi-autonomous.mjs --phase tui-ultrawork-workflow --use-real-kimi-home --evidence-root .omo/evidence/<ultrawork-full-cycle-after>',
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
  if (/Already in plan mode/i.test(normalized)) {
    failures.push('capture shows internal plan-mode re-entry error');
  }
  failures.push(...defaultUserSurfaceLeakFailures(scenario, normalized));

  switch (scenario) {
    case 'startup':
      if (!matchesAny(normalized, [/kimi/i, /ask/i, /message/i, /editor/i, /auto/i])) {
        failures.push('startup capture does not show a Kimi startup/editor state');
      }
      if (shouldRequireModelSetupAction(normalized) && !hasLoggedOutSetupNextAction(normalized)) {
        failures.push('startup capture does not point logged-out users at setup before task entry');
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
      if (shouldRequireModelSetupAction(normalized) && !hasLoggedOutSetupNextAction(normalized)) {
        failures.push('status capture does not keep the footer setup next action visible');
      }
      if (shouldRequireModelSetupAction(normalized) && !hasStatusPanelSetupNextAction(normalized)) {
        failures.push('status capture does not align model-needed readiness with setup options');
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

async function evaluateKnowledgeMapContractGate() {
  const contractPath = path.resolve(ULTRAWORK_CONTRACT_PATH);
  const contractArtifact = await fileStatus(contractPath);
  const failures = [];
  const phraseStatuses = {};
  if (!contractArtifact.exists || contractArtifact.bytes === 0) {
    failures.push(`missing Ultrawork contract: ${ULTRAWORK_CONTRACT_PATH}`);
  } else {
    const contract = await readFile(contractPath, 'utf8');
    for (const phrase of KNOWLEDGE_MAP_CONTRACT_PHRASES) {
      const present = contract.includes(phrase);
      phraseStatuses[phrase] = present;
      if (!present) failures.push(`Ultrawork contract is missing knowledge-map phrase: ${phrase}`);
    }
  }

  return {
    name: 'knowledge-map-contract',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'Ultrawork requires a compact internal project knowledge map with confidence-labelled relationships before broad exploration.'
        : failures.join('; '),
    observed: {
      contractPath,
      contractBytes: contractArtifact.bytes,
      phraseStatuses,
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
  if (ROOT_EVIDENCE_SUMMARY_FILES.has(path.basename(inputPath))) {
    return path.join(path.dirname(inputPath), 'cleanup', 'receipt.json');
  }
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
    `- real workflow: ${report.inputs.workflowSummary}`,
    ...(report.inputs.ultraworkSummary === undefined
      ? []
      : [`- Ultrawork workflow: ${report.inputs.ultraworkSummary}`]),
    ...(report.inputs.baselineSotaSummary === undefined
      ? []
      : [`- baseline SOTA: ${report.inputs.baselineSotaSummary}`]),
  ];
  if (report.loopScorecard !== undefined) {
    lines.push(
      '',
      '## Super Kimi Loop Score',
      '',
      `- score: ${report.loopScorecard.score}/${report.loopScorecard.maxScore}`,
      `- threshold: ${report.loopScorecard.threshold}`,
      `- status: ${report.loopScorecard.status}`,
      `- principle: ${report.loopScorecard.principle}`,
      '',
      '| Dimension | Score | Status | Evidence |',
      '|---|---:|---:|---|',
    );
    for (const dimension of report.loopScorecard.dimensions) {
      const misses = dimension.parts
        .filter((part) => part.status !== 'PASS')
        .map((part) => part.name);
      const evidence =
        misses.length === 0
          ? 'all evidence parts passed'
          : `missing: ${misses.map((part) => escapeMarkdown(part)).join(', ')}`;
      lines.push(
        `| ${escapeMarkdown(dimension.label)} | ${dimension.score}/${dimension.maxPoints} | ${dimension.status} | ${evidence} |`,
      );
    }
    if (Array.isArray(report.loopScorecard.definitionOfDone) && report.loopScorecard.definitionOfDone.length > 0) {
      lines.push('', '### Definition of Done', '');
      for (const item of report.loopScorecard.definitionOfDone) {
        lines.push(`- ${item}`);
      }
    }
    if (Array.isArray(report.loopScorecard.xpLite) && report.loopScorecard.xpLite.length > 0) {
      lines.push('', '### XP-lite Harness Rules', '');
      for (const item of report.loopScorecard.xpLite) {
        lines.push(`- ${item}`);
      }
    }
    if (Array.isArray(report.loopScorecard.humanWriting) && report.loopScorecard.humanWriting.length > 0) {
      lines.push('', '### Human Writing / Anti-Slop Rules', '');
      for (const item of report.loopScorecard.humanWriting) {
        lines.push(`- ${item}`);
      }
    }
  }
  lines.push(
    '',
    '## Gates',
    '',
    '| Gate | Status | Required | Reason |',
    '|---|---:|---:|---|',
  );
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
  const tuiScenarioGate = report.gates.find((gate) => gate.name === 'live-tui-required-scenarios');
  const tuiScenarios = Array.isArray(tuiScenarioGate?.observed?.scenarios)
    ? tuiScenarioGate.observed.scenarios
    : [];
  if (tuiScenarios.length > 0) {
    lines.push(
      '',
      '## Live TUI Scenario Evidence',
      '',
      '| Scenario | Status | Screen | Input | Signals |',
      '|---|---:|---:|---:|---|',
    );
    for (const scenario of tuiScenarios) {
      const signals = Array.isArray(scenario.screenObservationSignals)
        ? scenario.screenObservationSignals.join(', ')
        : '';
      lines.push(
        `| ${escapeMarkdown(scenario.scenario)} | ${escapeMarkdown(scenario.status)} | ${escapeMarkdown(scenario.screenObservationStatus)} | ${escapeMarkdown(scenario.inputTraceStatus)} | ${escapeMarkdown(signals)} |`,
      );
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
  if (report.tuiWorkflowProof !== undefined) {
    lines.push(
      '',
      '## Real TUI Workflow Proof',
      '',
      `- status: ${report.tuiWorkflowProof.status}`,
      `- mode: ${report.tuiWorkflowProof.kimiCodeHomeMode}`,
      `- agent verification evidence: ${String(report.tuiWorkflowProof.agentVerificationEvidenceCount)}`,
      `- edited files: ${String(report.tuiWorkflowProof.workspace?.editedFileCount ?? 'unavailable')}`,
      `- targeted test exit code: ${String(report.tuiWorkflowProof.workspace?.targetedTestExitCode ?? 'unavailable')}`,
      `- adaptive observations: ${String(report.tuiWorkflowProof.adaptiveObservationCount ?? 'unavailable')}`,
      `- adaptive interventions: ${String(report.tuiWorkflowProof.adaptiveInterventionsAttempted ?? 'unavailable')}`,
      `- verification exit code: ${String(report.tuiWorkflowProof.workspace?.verificationExitCode ?? 'unavailable')}`,
    );
  }
  if (report.tuiUltraworkProof !== undefined) {
    lines.push(
      '',
      '## Live TUI Ultrawork Proof',
      '',
      `- status: ${report.tuiUltraworkProof.status}`,
      `- mode: ${report.tuiUltraworkProof.kimiCodeHomeMode}`,
      `- activation evidence: ${String(report.tuiUltraworkProof.activationEvidenceCount)}`,
      `- interview evidence: ${String(report.tuiUltraworkProof.interviewEvidenceCount)}`,
      `- question evidence: ${String(report.tuiUltraworkProof.questionEvidenceCount)}`,
      `- question answer evidence: ${String(report.tuiUltraworkProof.questionAnswerEvidenceCount)}`,
      `- question handling: ${ultraworkQuestionHandlingLabel(report.tuiUltraworkProof)}`,
      `- post-question progress evidence: ${String(report.tuiUltraworkProof.postQuestionProgressEvidenceCount)}`,
      `- question tool contract errors: ${String(report.tuiUltraworkProof.questionToolErrorEvidenceCount)}`,
      `- policy conflicts: ${String(report.tuiUltraworkProof.policyConflictEvidenceCount)}`,
      `- adaptive observations: ${String(report.tuiUltraworkProof.adaptiveObservationCount ?? 'unavailable')}`,
      `- adaptive interventions: ${String(report.tuiUltraworkProof.adaptiveInterventionsAttempted ?? 'unavailable')}`,
    );
    if (report.tuiUltraworkProof.usageTelemetryMetrics !== undefined) {
      const metrics = report.tuiUltraworkProof.usageTelemetryMetrics;
      lines.push(
        `- usage telemetry: ${String(report.tuiUltraworkProof.usageTelemetryStatus)}`,
        `- token totals: input ${String(metrics.inputTokensApprox ?? 'unavailable')}, output ${String(metrics.outputTokensApprox ?? 'unavailable')}, total ${String(metrics.totalTokensApprox ?? 'unavailable')}`,
        `- cache telemetry: read ${String(metrics.cacheReadTokensApprox ?? 'unavailable')}, write ${String(metrics.cacheWriteTokensApprox ?? 'unavailable')}, share ${String(metrics.cacheSharePercent ?? 'unavailable')}%`,
        `- remaining context: ${String(metrics.remainingContextTokensApprox ?? 'unavailable')} tokens`,
      );
    }
    if (report.tuiUltraworkProof.usageTelemetryEfficiency !== undefined) {
      const efficiency = report.tuiUltraworkProof.usageTelemetryEfficiency;
      lines.push(
        `- usage efficiency gate: ${String(efficiency.status)} (cache share ${String(efficiency.cacheSharePercent ?? 'unavailable')}%, context ${String(efficiency.contextUsagePercent ?? 'unavailable')}%)`,
      );
    }
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

function ultraworkQuestionHandlingLabel(proof) {
  if (proof.questionBypassed === true) return 'no blocking question; proceeded with best judgment';
  if ((proof.questionAnswerEvidenceCount ?? 0) > 0) return 'question answered in TUI';
  return 'not observed';
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
