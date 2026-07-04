import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appendJsonl,
  commandRecord,
  estimateTokens,
  hasNonBlankEnv,
  readFileIfExists,
  resolveInside,
  runBoundedCommand,
} from './utils.mjs';

export const PROVIDER_REQUIRED_ENV = ['KIMI_MODEL_NAME', 'KIMI_MODEL_API_KEY'];
export const PROVIDER_BACKED_RUNNERS = new Set(['provider', 'ultrawork']);

const DEFAULT_TIMEOUT_MS = 120_000;

export async function runTaskSolver({ commandLogPath, options, sourceCheckout, task, workspace }) {
  if (options.runner === 'fixture') {
    return runFixtureSolver(commandLogPath, task, workspace);
  }
  if (options.runner === 'external') {
    return runExternalSolver(commandLogPath, options.solverCommand, task, workspace);
  }
  return runUltraworkSolver(commandLogPath, sourceCheckout, task, workspace, options.runner);
}

async function runFixtureSolver(commandLogPath, task, workspace) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const actions = task.fixtureActions ?? [];
  try {
    for (const action of actions) {
      await applyFixtureAction(workspace, action);
    }
    const record = {
      name: 'fixture-solver',
      runner: 'fixture',
      taskId: task.id,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      status: 'PASS',
      actionCount: actions.length,
    };
    await appendJsonl(commandLogPath, record);
    return {
      status: 'PASS',
      reason: 'Fixture runner applied deterministic task actions.',
      commandCount: actions.length,
      estimatedTokens: 0,
      record,
    };
  } catch (error) {
    const record = {
      name: 'fixture-solver',
      runner: 'fixture',
      taskId: task.id,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      status: 'FAIL',
      error: error.message,
    };
    await appendJsonl(commandLogPath, record);
    return {
      status: 'FAIL',
      reason: error.message,
      commandCount: actions.length,
      estimatedTokens: estimateTokens(error.message),
      record,
    };
  }
}

async function applyFixtureAction(workspace, action) {
  if (action.type === 'writeFile') {
    const target = resolveInside(workspace, action.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, action.content ?? '', 'utf8');
    return;
  }
  if (action.type === 'appendFile') {
    const target = resolveInside(workspace, action.path);
    const previous = (await readFileIfExists(target)) ?? '';
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${previous}${action.content ?? ''}`, 'utf8');
    return;
  }
  throw new Error(`Unsupported fixture action: ${action.type}`);
}

function runExternalSolver(commandLogPath, solverCommand, task, workspace) {
  const env = {
    ...process.env,
    KIMI_BENCH_TASK_ID: task.id,
    KIMI_BENCH_TASK_PROMPT: task.prompt,
    KIMI_BENCH_WORKSPACE: workspace,
  };
  const result = runBoundedCommand('/bin/sh', ['-lc', solverCommand], {
    cwd: workspace,
    env,
    timeoutMs: task.budgets?.maxWallMs ?? DEFAULT_TIMEOUT_MS,
  });
  const record = commandRecord('external-solver', task.id, result, {
    runner: 'external',
    solverCommand,
  });
  return appendJsonl(commandLogPath, record).then(() => ({
    status: result.status === 0 && !result.timedOut ? 'PASS' : 'FAIL',
    reason: result.timedOut ? 'External solver timed out.' : `External solver exited ${result.status}.`,
    commandCount: 1,
    estimatedTokens: estimateTokens(result.stdout) + estimateTokens(result.stderr),
    record,
  }));
}

function runUltraworkSolver(commandLogPath, sourceCheckout, task, workspace, runner = 'ultrawork') {
  const missing = PROVIDER_REQUIRED_ENV.filter((name) => !hasNonBlankEnv(process.env, name));
  const brandedRunnerName = runner === 'provider' ? 'SuperLiora provider' : 'Ultrawork';
  if (missing.length > 0) {
    const record = {
      name: runner === 'provider' ? 'superliora-provider-solver-preflight' : 'ultrawork-solver-preflight',
      runner,
      providerRunner: 'superliora-ultrawork',
      taskId: task.id,
      status: 'BLOCKED',
      reason: `Missing ${brandedRunnerName} credentials: ${missing.join(', ')}`,
      requiredEnv: PROVIDER_REQUIRED_ENV,
      missingEnv: missing,
      productCommandStarted: false,
      providerCallStarted: false,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return appendJsonl(commandLogPath, record).then(() => ({
      status: 'BLOCKED',
      reason: record.reason,
      commandCount: 0,
      estimatedTokens: 0,
      missingEnv: missing,
      providerCallStarted: false,
      record,
    }));
  }

  const kimiHome = path.join(workspace, '.liora-home');
  const prompt = [
    `/ultrawork ${task.title}`,
    '',
    'Internal benchmark task. Treat this task as user data and edit only the benchmark workspace.',
    `Workspace: ${workspace}`,
    task.prompt,
  ].join('\n');
  const env = {
    ...process.env,
    SUPERLIORA_HOME: kimiHome,
    SUPERLIORA_CACHE_DIR: path.join(workspace, '.liora-cache'),
  };
  const result = runBoundedCommand(
    'corepack',
    [
      'pnpm',
      '-C',
      'apps/liora',
      'run',
      'dev',
      '--',
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--add-dir',
      workspace,
    ],
    {
      cwd: sourceCheckout,
      env,
      timeoutMs: task.budgets?.maxWallMs ?? DEFAULT_TIMEOUT_MS,
    },
  );
  const record = commandRecord(runner === 'provider' ? 'superliora-provider-solver' : 'ultrawork-solver', task.id, result, {
    runner,
    providerRunner: 'superliora-ultrawork',
    requiredEnv: PROVIDER_REQUIRED_ENV,
    missingEnv: [],
    promptChars: prompt.length,
    productCommandStarted: true,
    providerCallStarted: null,
    providerCallEvidence: 'unknown: local CLI command started, but provider boundary is not directly instrumented here',
  });
  return appendJsonl(commandLogPath, record).then(() => ({
    status: result.status === 0 && !result.timedOut ? 'PASS' : 'FAIL',
    reason: result.timedOut ? `${brandedRunnerName} solver timed out.` : `${brandedRunnerName} solver exited ${result.status}.`,
    commandCount: 1,
    estimatedTokens: estimateTokens(prompt) + estimateTokens(result.stdout) + estimateTokens(result.stderr),
    productCommandStarted: true,
    providerCallStarted: null,
    record,
  }));
}
