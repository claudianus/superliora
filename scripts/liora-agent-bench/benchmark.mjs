import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { BENCH_SCHEMA_VERSION } from './constants.mjs';
import { buildImprovementProposal, renderLoopMarkdown } from './loop-report.mjs';
import { buildBenchmarkReport, renderBenchmarkMarkdown } from './report.mjs';
import { runTask } from './task-run.mjs';
import { loadTasks } from './task-bank.mjs';
import { resolveSourceCheckout, round, writeJson } from './utils.mjs';

export async function runBenchmark(options, runId, evidenceRoot) {
  const startedAt = new Date().toISOString();
  await prepareEvidenceRoot(evidenceRoot);
  const sourceCheckout = resolveSourceCheckout();
  const taskDir = path.resolve(options.taskDir);
  const taskLoad = await loadTasks(taskDir, options.suite);
  const commandLogPath = path.join(evidenceRoot, 'commands.jsonl');
  await writeFile(commandLogPath, '', 'utf8');

  const taskResults = [];
  for (const task of taskLoad.tasks) {
    taskResults.push(await runTask({ commandLogPath, evidenceRoot, options, sourceCheckout, task }));
  }

  const report = buildBenchmarkReport({
    evidenceRoot,
    options,
    runId,
    sourceCheckout,
    startedAt,
    taskDir,
    taskLoad,
    taskResults,
  });
  await writeJson(path.join(evidenceRoot, 'summary.json'), report);
  await writeFile(path.join(evidenceRoot, 'summary.md'), renderBenchmarkMarkdown(report), 'utf8');
  await writeJson(path.join(evidenceRoot, 'task-index.json'), taskLoad);

  if (!options.keepWorkspaces) await cleanupWorkspaces(report.taskResults);
  return report;
}

export async function runLoop(options, runId, evidenceRoot) {
  const startedAt = Date.now();
  await mkdir(evidenceRoot, { recursive: true });
  const iterations = [];
  let bestScore = -1;
  let stopReason = 'max_iterations_reached';
  for (let index = 1; index <= options.maxIterations; index += 1) {
    if (Date.now() - startedAt > options.maxTotalMs) {
      stopReason = 'max_total_ms_reached';
      break;
    }
    const iterationRoot = path.join(evidenceRoot, 'iterations', String(index).padStart(2, '0'));
    const report = await runBenchmark(options, `${runId}-i${index}`, iterationRoot);
    const delta = bestScore < 0 ? report.metrics.score : round(report.metrics.score - bestScore);
    if (report.metrics.score > bestScore) bestScore = report.metrics.score;
    const proposal = buildImprovementProposal(report, delta, index);
    await writeFile(path.join(iterationRoot, 'improvement-proposal.md'), proposal.markdown, 'utf8');
    iterations.push({
      index,
      status: report.status,
      score: report.metrics.score,
      passRate: report.metrics.passRate,
      counts: report.counts,
      quarantine: summarizeQuarantine(report),
      focus: summarizeFocus(report),
      delta,
      evidenceRoot: iterationRoot,
      proposal: proposal.summary,
    });
    if (report.counts.quarantined > 0) {
      stopReason = 'quarantine_pending';
      break;
    }
    if (report.status === 'PASS' && report.metrics.score >= 1) {
      stopReason = 'score_ceiling_reached';
      break;
    }
    if (delta <= 0 && index > 1) {
      stopReason = 'no_score_delta';
      break;
    }
  }
  const summary = buildLoopSummary({ bestScore, evidenceRoot, iterations, options, runId, startedAt, stopReason });
  await writeJson(path.join(evidenceRoot, 'loop-summary.json'), summary);
  await writeFile(path.join(evidenceRoot, 'loop-summary.md'), renderLoopMarkdown(summary), 'utf8');
  return summary;
}

async function prepareEvidenceRoot(evidenceRoot) {
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(path.join(evidenceRoot, 'tasks'), { recursive: true });
  await mkdir(path.join(evidenceRoot, 'workspaces'), { recursive: true });
}

function summarizeQuarantine(report) {
  const tasks = report.taskResults
    .filter((task) => task.status === 'QUARANTINED')
    .slice(0, 3)
    .map((task) => ({
      id: task.id,
      title: task.title,
      findings: task.contamination?.findings ?? [],
      reason: task.blockedReason,
    }));
  return {
    count: report.counts.quarantined,
    tasks,
  };
}

function summarizeFocus(report) {
  const tasks = report.taskResults
    .filter((task) => task.status === 'FAIL' || task.status === 'BLOCKED' || task.status === 'QUARANTINED')
    .slice(0, 3)
    .map((task) => {
      const resultPath = path.join(task.taskDir, 'result.json');
      const displayPath = displayEvidenceRoot(resultPath);
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        score: task.score,
        taxonomy: task.taxonomy.slice(0, 3),
        reason: focusReason(task),
        action: `cat ${shellArg(displayPath)}`,
        displayPath,
        resultPath,
      };
    });
  return {
    status: tasks.length === 0 ? 'clean' : 'attention',
    taxonomy: topTaxonomy(report.taxonomy),
    tasks,
  };
}

function focusReason(task) {
  const failedCheck = task.checks.find((check) => check.status !== 'PASS');
  return task.blockedReason ?? failedCheck?.reason ?? task.error;
}

function topTaxonomy(taxonomy) {
  return Object.entries(taxonomy)
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));
}

function buildLoopSummary({ bestScore, evidenceRoot, iterations, options, runId, startedAt, stopReason }) {
  const rerunEvidenceRoot = displayEvidenceRoot(evidenceRoot);
  const rerunArgv = buildLoopRerunArgv(options, rerunEvidenceRoot);
  const status = stopReason === 'quarantine_pending'
    ? 'BLOCKED'
    : iterations.some((iteration) => iteration.status === 'FAIL')
    ? 'FAIL'
    : iterations.some((iteration) => iteration.status === 'BLOCKED')
      ? 'BLOCKED'
      : iterations.some((iteration) => iteration.status === 'QUARANTINED')
        ? 'QUARANTINED'
        : 'PASS';
  return {
    schemaVersion: BENCH_SCHEMA_VERSION,
    benchmark: 'liora-agent-bench-loop',
    runId,
    status,
    reason: `Bounded loop stopped: ${stopReason}.`,
    stopReason,
    maxIterations: options.maxIterations,
    maxTotalMs: options.maxTotalMs,
    wallClockMs: Date.now() - startedAt,
    bestScore: Math.max(0, bestScore),
    iterations,
    guardrails: {
      bounded: true,
      maxIterations: options.maxIterations,
      maxTotalMs: options.maxTotalMs,
      executeCodeChanges: false,
      note: 'This loop records improvement proposals and evidence; code changes still go through Ultrawork implementation and QA gates.',
    },
    rerun: {
      command: buildLoopRerunCommand(rerunArgv),
      argv: rerunArgv,
      evidenceRoot: rerunEvidenceRoot,
    },
  };
}

function buildLoopRerunArgv(options, evidenceRoot) {
  const argv = [
    'node',
    'scripts/liora-agent-bench.mjs',
    '--loop',
    '--task-dir',
    displayEvidenceRoot(path.resolve(options.taskDir)),
    '--suite',
    options.suite,
    '--runner',
    options.runner,
  ];
  if (options.solverCommand !== undefined) argv.push('--solver-command', options.solverCommand);
  argv.push(
    '--max-total-ms',
    String(options.maxTotalMs),
    '--max-iterations',
    String(options.maxIterations),
    '--evidence-root',
    evidenceRoot,
  );
  return argv;
}

function buildLoopRerunCommand(argv) {
  return argv.map(shellArg).join(' ');
}

function displayEvidenceRoot(evidenceRoot) {
  const relative = path.relative(process.cwd(), evidenceRoot);
  if (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return evidenceRoot;
}

function shellArg(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function cleanupWorkspaces(taskResults) {
  for (const task of taskResults) {
    await rm(task.workspace, { recursive: true, force: true });
  }
}
