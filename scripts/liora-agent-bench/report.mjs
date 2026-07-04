import { BENCH_SCHEMA_VERSION } from './constants.mjs';
import { PROVIDER_BACKED_RUNNERS, PROVIDER_REQUIRED_ENV } from './runners.mjs';
import { countBy, round, unique } from './utils.mjs';

export function buildBenchmarkReport({
  evidenceRoot,
  options,
  runId,
  sourceCheckout,
  startedAt,
  taskDir,
  taskLoad,
  taskResults,
}) {
  const completedAt = new Date().toISOString();
  const scored = taskResults.filter((task) => task.status !== 'QUARANTINED');
  const passed = scored.filter((task) => task.status === 'PASS');
  const blocked = scored.filter((task) => task.status === 'BLOCKED');
  const failed = scored.filter((task) => task.status === 'FAIL');
  const quarantined = taskResults.filter((task) => task.status === 'QUARANTINED');
  const score = scored.length === 0
    ? 0
    : round(scored.reduce((sum, task) => sum + task.score, 0) / scored.length);
  const passRate = scored.length === 0 ? 0 : round(passed.length / scored.length);
  const taxonomy = countBy(taskResults.flatMap((task) => task.taxonomy));
  const wallClockMs = taskResults.reduce((sum, task) => sum + task.wallClockMs, 0);
  const estimatedTokens = taskResults.reduce((sum, task) => sum + task.estimatedTokens, 0);
  const commandCount = taskResults.reduce((sum, task) => sum + task.commandCount, 0);
  const budget = buildBudgetSummary(taskResults);
  const status =
    failed.length > 0 ? 'FAIL' : blocked.length > 0 ? 'BLOCKED' : passed.length > 0 ? 'PASS' : 'QUARANTINED';
  return {
    schemaVersion: BENCH_SCHEMA_VERSION,
    benchmark: 'liora-agent-bench',
    runId,
    status,
    reason: benchmarkReason(status, { passed, blocked, failed, quarantined, scored }),
    startedAt,
    completedAt,
    sourceCheckout,
    evidenceRoot,
    taskDir: String(taskDir),
    suite: options.suite,
    runner: options.runner,
    counts: {
      discovered: taskLoad.discovered,
      selected: taskResults.length,
      scored: scored.length,
      passed: passed.length,
      failed: failed.length,
      blocked: blocked.length,
      quarantined: quarantined.length,
    },
    metrics: {
      score,
      passRate,
      wallClockMs,
      estimatedTokens,
      commandCount,
      averageWallClockMs: scored.length === 0 ? 0 : Math.round(wallClockMs / scored.length),
    },
    aggregateSummary: {
      passRate,
      score,
      wallClockMs,
      estimatedTokens,
      commandCount,
    },
    budget,
    provider: buildProviderSummary(options, taskResults),
    taxonomy,
    taskResults,
    holdout: buildHoldoutContract(options.suite, taskLoad, taskResults),
    antiOverfit: {
      trainSuite: 'seed',
      holdoutSuite: 'holdout',
      contaminationGuard: 'Tasks with blocked answer/stale-evidence files are quarantined before solver execution.',
      judgePolicy: 'Programmatic checks decide core pass/fail; LLM/Ouroboros review may be attached as secondary evidence only.',
    },
  };
}

export function renderBenchmarkMarkdown(report) {
  const lines = [
    '# SuperLiora Agent Bench Report',
    '',
    `Status: **${report.status}**`,
    `Reason: ${report.reason}`,
    `Run ID: ${report.runId}`,
    `Suite: ${report.suite}`,
    `Runner: ${report.runner}`,
    '',
    '## Score',
    '',
    `- score: ${report.metrics.score}`,
    `- passRate: ${report.metrics.passRate}`,
    `- estimatedTokens: ${report.metrics.estimatedTokens}`,
    `- wallClockMs: ${report.metrics.wallClockMs}`,
    `- commandCount: ${report.metrics.commandCount}`,
    `- budgetStatus: ${report.budget.status}`,
    `- budgetExceeded: ${report.budget.exceeded}`,
    `- holdoutStatus: ${report.holdout.status}`,
    `- providerCallStarted: ${report.provider.providerCallStarted}`,
    `- providerPreflight: ${report.provider.credentialPreflight}`,
    '',
    '## Tasks',
    '',
    '| task | suite | status | score | wall ms | budget | taxonomy |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
  ];
  for (const task of report.taskResults) {
    lines.push(
      `| ${task.id} | ${task.suite} | ${task.status} | ${task.score} | ${task.wallClockMs} | ${task.budget?.status ?? 'unknown'} | ${task.taxonomy.join(', ')} |`,
    );
  }
  lines.push(
    '',
    '## Anti-Overfit Contract',
    '',
    `- trainSuite: ${report.antiOverfit.trainSuite}`,
    `- holdoutSuite: ${report.antiOverfit.holdoutSuite}`,
    `- holdoutStatus: ${report.holdout.status}`,
    `- holdoutSelected: ${report.holdout.selected}`,
    `- holdoutContract: ${report.holdout.contract}`,
    `- contaminationGuard: ${report.antiOverfit.contaminationGuard}`,
    `- judgePolicy: ${report.antiOverfit.judgePolicy}`,
    `- providerRunner: ${report.provider.runnerKind}`,
    '',
  );
  return `${lines.join('\n')}\n`;
}

function buildBudgetSummary(taskResults) {
  const exceededTasks = taskResults.filter((task) => task.budget?.status === 'FAIL');
  return {
    status: exceededTasks.length === 0 ? 'PASS' : 'FAIL',
    checked: taskResults.filter((task) => task.budget !== undefined).length,
    exceeded: exceededTasks.length,
    tasks: exceededTasks.map((task) => ({
      id: task.id,
      violations: task.budget.violations,
    })),
  };
}

function buildProviderSummary(options, taskResults) {
  const providerBacked = PROVIDER_BACKED_RUNNERS.has(options.runner);
  const runnerRecords = taskResults.map((task) => task.runnerResult?.record).filter(Boolean);
  const missingEnv = unique(runnerRecords.flatMap((record) => record.missingEnv ?? []));
  const productCommandStarted = runnerRecords.some((record) => record.productCommandStarted === true);
  const observedProviderCall = runnerRecords.some((record) => record.providerCallStarted === true);
  const providerCallStarted = observedProviderCall ? true : productCommandStarted ? null : false;
  return {
    providerBacked,
    runnerKind: options.runner,
    requiredEnv: providerBacked ? PROVIDER_REQUIRED_ENV : [],
    missingEnv,
    credentialPreflight:
      !providerBacked
        ? 'not_applicable'
        : missingEnv.length > 0
          ? 'blocked_missing_env'
          : 'ready',
    productCommandStarted,
    providerCallStarted,
    providerCallEvidence:
      providerCallStarted === null
        ? 'unknown: product command started but provider boundary is not directly instrumented'
        : 'direct command-log preflight evidence',
    noProviderCallWhenBlocked: missingEnv.length === 0 || providerCallStarted === false,
  };
}

function buildHoldoutContract(suite, taskLoad, taskResults) {
  const selected = taskResults.filter((task) => task.suite === 'holdout').length;
  const sourceSummaries = taskLoad.allTaskSummaries ?? taskLoad.taskSummaries;
  const available = sourceSummaries.filter((task) => task.suite === 'holdout').length;
  if (suite === 'holdout') {
    return {
      status: 'active',
      suite,
      selected,
      available,
      contract: 'This run selected only holdout tasks; use it as sealed evaluation evidence, not training feedback.',
    };
  }
  return {
    status: 'not_run',
    suite,
    selected,
    available,
    contract: 'This run is not a holdout-only evaluation; do not report it as holdout performance.',
  };
}

function benchmarkReason(status, counts) {
  if (status === 'PASS') {
    return `${counts.passed.length}/${counts.scored.length} scored task(s) passed; ${counts.quarantined.length} task(s) quarantined by guard.`;
  }
  if (status === 'BLOCKED') {
    return `${counts.blocked.length} scored task(s) blocked by environment preflight.`;
  }
  if (status === 'QUARANTINED') {
    return 'All selected tasks were quarantined before solving.';
  }
  return `${counts.failed.length} scored task(s) failed checks or solver execution.`;
}
