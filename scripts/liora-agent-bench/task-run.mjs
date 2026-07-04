import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { BENCH_SCHEMA_VERSION } from './constants.mjs';
import { runChecks, scoreChecks } from './checks.mjs';
import { runTaskSolver } from './runners.mjs';
import { estimateTokens, exists, resolveInside, safeFileName, writeJson } from './utils.mjs';

export async function runTask({ commandLogPath, evidenceRoot, options, sourceCheckout, task }) {
  const startedAt = new Date().toISOString();
  const taskDir = path.join(evidenceRoot, 'tasks', safeFileName(task.id));
  const workspace = path.join(evidenceRoot, 'workspaces', safeFileName(task.id));
  await prepareTaskWorkspace(taskDir, workspace);
  await writeJson(path.join(taskDir, 'task.json'), publicTask(task));

  const result = initialTaskResult({ options, startedAt, task, taskDir, workspace });
  const startedMs = Date.now();

  try {
    await applySetup(workspace, task.setup?.files ?? []);
    const contamination = await inspectContamination(workspace, task);
    result.contamination = contamination;
    if (contamination.status !== 'PASS') return await finishQuarantined(taskDir, result, contamination, task, startedMs);
    if (task.expectedOutcome === 'QUARANTINED') return await finishQuarantineRegression(taskDir, result, task, startedMs);

    const runnerResult = await runTaskSolver({ commandLogPath, options, sourceCheckout, task, workspace });
    applyRunnerResult(result, runnerResult);
    if (runnerResult.status === 'BLOCKED') return await finishBlocked(taskDir, result, runnerResult, task, startedMs);
    if (runnerResult.status !== 'PASS') result.taxonomy.push('solver_failed');

    await scoreTaskChecks(result, task.checks, sourceCheckout, workspace);
  } catch (error) {
    result.status = 'FAIL';
    result.error = error.message;
    result.taxonomy.push('harness_error');
  }

  return finishTask(taskDir, result, task, startedMs);
}

async function prepareTaskWorkspace(taskDir, workspace) {
  await mkdir(taskDir, { recursive: true });
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
}

function initialTaskResult({ options, startedAt, task, taskDir, workspace }) {
  return {
    schemaVersion: BENCH_SCHEMA_VERSION,
    id: task.id,
    title: task.title,
    suite: task.suite,
    runner: options.runner,
    status: 'FAIL',
    score: 0,
    startedAt,
    completedAt: undefined,
    wallClockMs: 0,
    promptChars: task.prompt.length,
    estimatedTokens: estimateTokens(task.prompt),
    commandCount: 0,
    workspace,
    taskDir,
    checks: [],
    taxonomy: [],
    blockedReason: undefined,
  };
}

function applyRunnerResult(result, runnerResult) {
  result.runnerResult = runnerResult;
  result.commandCount = runnerResult.commandCount;
  result.estimatedTokens += runnerResult.estimatedTokens;
}

async function finishQuarantined(taskDir, result, contamination, task, startedMs) {
  result.status = 'QUARANTINED';
  result.taxonomy.push('contamination_guard');
  result.blockedReason = contamination.reason;
  return finishTask(taskDir, result, task, startedMs);
}

async function finishQuarantineRegression(taskDir, result, task, startedMs) {
  result.status = 'FAIL';
  result.taxonomy.push('quarantine_regression');
  result.blockedReason = 'Task expected quarantine, but the contamination guard allowed solver execution.';
  return finishTask(taskDir, result, task, startedMs);
}

async function finishBlocked(taskDir, result, runnerResult, task, startedMs) {
  result.status = 'BLOCKED';
  result.blockedReason = runnerResult.reason;
  result.taxonomy.push('environment_blocked');
  return finishTask(taskDir, result, task, startedMs);
}

async function scoreTaskChecks(result, checks, sourceCheckout, workspace) {
  result.checks = await runChecks({ checks, sourceCheckout, workspace });
  const checkCommands = result.checks.filter((check) => check.command !== undefined);
  result.commandCount += checkCommands.length;
  result.estimatedTokens += checkCommands.reduce(
    (sum, check) =>
      sum +
      estimateTokens(check.command?.stdout) +
      estimateTokens(check.command?.stderr) +
      estimateTokens(check.command?.error),
    0,
  );
  const failedChecks = result.checks.filter((check) => check.status !== 'PASS');
  result.score = scoreChecks(result.checks);
  if (result.runnerResult.status === 'PASS' && failedChecks.length === 0) {
    result.status = 'PASS';
  } else {
    result.status = 'FAIL';
    if (failedChecks.length > 0) result.taxonomy.push('check_failed');
  }
}

async function finishTask(taskDir, result, task, startedMs) {
  result.completedAt = new Date().toISOString();
  result.wallClockMs = Date.now() - startedMs;
  result.budget = evaluateTaskBudget(result, task.budgets);
  if (result.status === 'PASS' && result.budget.status === 'FAIL') {
    result.status = 'FAIL';
    result.score = 0;
    result.taxonomy.push('budget_exceeded');
    result.blockedReason = `Task exceeded benchmark budget: ${result.budget.violations.join(', ')}`;
  }
  await writeJson(path.join(taskDir, 'result.json'), result);
  return result;
}

function evaluateTaskBudget(result, budgets = {}) {
  const actual = {
    wallMs: result.wallClockMs,
    commands: result.commandCount,
    promptChars: result.promptChars,
  };
  const limits = {
    maxWallMs: budgets.maxWallMs,
    maxCommands: budgets.maxCommands,
    maxPromptChars: budgets.maxPromptChars,
  };
  const violations = [];
  if (typeof limits.maxWallMs === 'number' && actual.wallMs > limits.maxWallMs) {
    violations.push(`wallMs ${actual.wallMs} > ${limits.maxWallMs}`);
  }
  if (typeof limits.maxCommands === 'number' && actual.commands > limits.maxCommands) {
    violations.push(`commands ${actual.commands} > ${limits.maxCommands}`);
  }
  if (typeof limits.maxPromptChars === 'number' && actual.promptChars > limits.maxPromptChars) {
    violations.push(`promptChars ${actual.promptChars} > ${limits.maxPromptChars}`);
  }
  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    actual,
    limits,
    violations,
  };
}

function publicTask(task) {
  return {
    schemaVersion: task.schemaVersion,
    id: task.id,
    title: task.title,
    suite: task.suite,
    kind: task.kind,
    risk: task.risk,
    expectedOutcome: task.expectedOutcome,
    tags: task.tags ?? [],
    prompt: task.prompt,
    budgets: task.budgets,
    contamination: task.contamination,
    checks: task.checks,
  };
}

async function applySetup(workspace, files) {
  for (const file of files) {
    const target = resolveInside(workspace, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content ?? '', 'utf8');
  }
}

async function inspectContamination(workspace, task) {
  const blockedFiles = task.contamination?.blockedFiles ?? [];
  const findings = [];
  for (const blockedFile of blockedFiles) {
    const target = resolveInside(workspace, blockedFile);
    if (await exists(target)) findings.push(blockedFile);
  }
  return {
    status: findings.length === 0 ? 'PASS' : 'QUARANTINED',
    reason:
      findings.length === 0
        ? 'No blocked answer or stale evidence files were present before solving.'
        : `Task quarantined before solving because blocked files were present: ${findings.join(', ')}`,
    findings,
  };
}
