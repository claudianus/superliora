#!/usr/bin/env node
/* eslint-disable no-console */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_CRITERIA_PATH = '.omo/bench/sota-criteria.json';
const DEFAULT_OUTPUT_BASE = '.omo/evidence/kimi-agent-sota-gate';
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
const DEFAULT_BUDGETS = Object.freeze({
  wallClockMs: 30_000,
  commandCount: 10,
  estimatedTokens: 800,
});
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
  const inputs = {
    systemSummary: path.resolve(options.systemSummary),
    loopSummary: path.resolve(options.loopSummary),
    tuiSummary: path.resolve(options.tuiSummary),
  };
  const systemSummary = await readJsonRequired(inputs.systemSummary, 'bench-system summary');
  const loopSummary = await readJsonRequired(inputs.loopSummary, 'bench-system-loop summary');
  const tuiSummary = await readJsonRequired(inputs.tuiSummary, 'live TUI summary');

  const gates = [
    evaluateSystemGate(systemSummary),
    evaluateLoopGate(loopSummary),
    await evaluateTuiGate(tuiSummary),
    evaluateBudgetGate(systemSummary, budgets),
    await evaluateNoWebUiSurfaceGate(inputs),
    await evaluateSecretScanGate(inputs, criteriaPath),
    await evaluateCleanupReceiptGate(inputs, options.requireCleanupReceipt),
  ];
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

async function evaluateTuiGate(summary) {
  const failures = [];
  const captures = Array.isArray(summary.captures) ? summary.captures : [];
  if (summary.status !== 'PASS') failures.push(`TUI summary status is ${String(summary.status)}`);
  const scenarioResults = [];
  for (const scenario of REQUIRED_TUI_SCENARIOS) {
    const capture = captures.find((entry) => entry.scenario === scenario);
    const file = capture?.path;
    const artifact = file === undefined ? { exists: false, bytes: 0 } : await fileStatus(file);
    const passed = capture?.status === 'PASS' && artifact.exists && artifact.bytes > 0;
    if (!passed) failures.push(`missing passing live TUI scenario: ${scenario}`);
    scenarioResults.push({
      scenario,
      status: passed ? 'PASS' : 'FAIL',
      captureStatus: capture?.status,
      path: file,
      bytes: artifact.bytes,
    });
  }
  return {
    name: 'live-tui-required-scenarios',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'All required live TUI scenarios have passing non-empty capture artifacts.'
        : failures.join('; '),
    observed: {
      summaryStatus: summary.status,
      exitSessionClosed: summary.validations?.exitSessionClosed?.status,
      scenarios: scenarioResults,
    },
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

  const webUiInputs = Object.entries(inputs)
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

async function fileStatus(file) {
  try {
    const info = await stat(file);
    return { exists: info.isFile(), bytes: info.size };
  } catch {
    return { exists: false, bytes: 0 };
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
