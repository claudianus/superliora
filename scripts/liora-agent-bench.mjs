#!/usr/bin/env node
/* eslint-disable no-console */

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { runBenchmark, runLoop } from './liora-agent-bench/benchmark.mjs';
import { createRunId, parseArgs, usage } from './liora-agent-bench/cli-options.mjs';
import { DEFAULT_EVIDENCE_BASE } from './liora-agent-bench/constants.mjs';
import { appendJsonl, commandRecord, runBoundedCommand, writeJson } from './liora-agent-bench/utils.mjs';

const REPLAY_TIMEOUT_BUFFER_MS = 30_000;

async function main() {
  const { errors, options } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    console.error('Run with --help for usage.');
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const runId = createRunId();
  const evidenceRoot = path.resolve(options.evidenceRoot ?? path.join(DEFAULT_EVIDENCE_BASE, runId));
  if (options.replaySummary !== undefined) {
    const result = await runReplay(options, evidenceRoot);
    console.log(`Evidence root: ${evidenceRoot}`);
    console.log(`Status: ${result.status}`);
    console.log(`Score: ${result.loopSummary?.bestScore ?? 0}`);
    applyExitStatus(result.status, options.expectStatus, result.forceFailure);
    return;
  }

  const result = options.loop
    ? await runLoop(options, runId, evidenceRoot)
    : await runBenchmark(options, runId, evidenceRoot);
  console.log(`Evidence root: ${evidenceRoot}`);
  console.log(`Status: ${result.status}`);
  console.log(`Score: ${result.metrics?.score ?? result.bestScore ?? 0}`);
  applyExitStatus(result.status, options.expectStatus, false);
}

function applyExitStatus(status, expectStatus, forceFailure) {
  const expectedStatusMatched =
    expectStatus !== undefined && status === expectStatus;
  if (expectStatus !== undefined && !expectedStatusMatched) {
    console.error(`Expected status ${expectStatus}, got ${status}`);
    process.exitCode = 1;
    return;
  }
  if (forceFailure) {
    process.exitCode = 1;
    return;
  }
  if (
    !expectedStatusMatched &&
    (status === 'FAIL' || status === 'BLOCKED' || status === 'QUARANTINED')
  ) {
    process.exitCode = 1;
  }
}

async function runReplay(options, evidenceRoot) {
  await mkdir(evidenceRoot, { recursive: true });
  const commandLogPath = path.join(evidenceRoot, 'commands.jsonl');
  await writeFile(commandLogPath, '', 'utf8');
  const replaySummaryPath = path.join(evidenceRoot, 'replay-summary.json');
  const sourceSummaryPath = path.resolve(options.replaySummary);
  let childStarted = false;
  let commandResult;

  try {
    const sourceSummary = JSON.parse(await readFile(sourceSummaryPath, 'utf8'));
    const originalArgv = validateReplayArgv(sourceSummary?.rerun?.argv);
    const replayArgv = replaceEvidenceRootArgv(originalArgv, evidenceRoot);
    const onlyEvidenceRootChanged = hasOnlyEvidenceRootChanged(originalArgv, replayArgv);
    childStarted = true;
    commandResult = runBoundedCommand(replayArgv[0], replayArgv.slice(1), {
      cwd: process.cwd(),
      timeoutMs: options.maxTotalMs + REPLAY_TIMEOUT_BUFFER_MS,
    });
    await appendJsonl(commandLogPath, commandRecord('replay-loop', 'loop', commandResult, {
      childStarted: true,
      sourceSummaryPath,
      originalArgv,
      executedArgv: replayArgv,
      onlyEvidenceRootChanged,
      shellParsing: false,
    }));
    const loopSummaryPath = path.join(evidenceRoot, 'loop-summary.json');
    const loopSummary = JSON.parse(await readFile(loopSummaryPath, 'utf8'));
    const forceFailure =
      !onlyEvidenceRootChanged || (loopSummary.status === 'PASS' && commandResult.status !== 0);
    const replaySummary = {
      schemaVersion: loopSummary.schemaVersion,
      benchmark: 'superliora-agent-bench-loop-replay',
      status: forceFailure ? 'FAIL' : loopSummary.status,
      reason: `Replayed loop summary from ${sourceSummaryPath}.`,
      childStarted: true,
      childExitCode: commandResult.status,
      childSignal: commandResult.signal,
      childTimedOut: commandResult.timedOut,
      childDurationMs: commandResult.durationMs,
      sourceSummaryPath,
      evidenceRoot,
      originalArgv,
      executedArgv: replayArgv,
      onlyEvidenceRootChanged,
      shellParsing: false,
      command: {
        argv: replayArgv,
        cwd: process.cwd(),
      },
      replayedLoopSummary: loopSummary,
      loopSummary,
    };
    await writeJson(replaySummaryPath, replaySummary);
    return { ...replaySummary, loopSummary, forceFailure };
  } catch (error) {
    const replaySummary = {
      benchmark: 'superliora-agent-bench-loop-replay',
      status: 'FAIL',
      reason: error.message,
      childStarted,
      childExitCode: commandResult?.status,
      childSignal: commandResult?.signal,
      childTimedOut: commandResult?.timedOut,
      childDurationMs: commandResult?.durationMs,
      sourceSummaryPath,
      evidenceRoot,
    };
    await writeJson(replaySummaryPath, replaySummary);
    return { ...replaySummary, forceFailure: true };
  }
}

function validateReplayArgv(argv) {
  if (!Array.isArray(argv) || !argv.every((entry) => typeof entry === 'string')) {
    throw new Error('Replay summary rerun.argv must be an array of strings.');
  }
  if (argv[0] !== 'node' || argv[1] !== 'scripts/liora-agent-bench.mjs') {
    throw new Error('Replay rerun.argv must begin with node scripts/liora-agent-bench.mjs.');
  }
  if (argv.some((entry) => entry === '--replay-summary' || entry.startsWith('--replay-summary='))) {
    throw new Error('Replay rerun.argv must not include --replay-summary.');
  }
  return argv;
}

function replaceEvidenceRootArgv(argv, evidenceRoot) {
  const nextArgv = [...argv];
  const evidenceRootIndexes = [];
  for (let index = 0; index < nextArgv.length; index += 1) {
    if (nextArgv[index] === '--evidence-root') evidenceRootIndexes.push(index);
    if (nextArgv[index].startsWith('--evidence-root=')) evidenceRootIndexes.push(index);
  }
  if (evidenceRootIndexes.length !== 1) {
    throw new Error('Replay rerun.argv must include exactly one --evidence-root value.');
  }
  const index = evidenceRootIndexes[0];
  if (nextArgv[index] === '--evidence-root') {
    if (typeof nextArgv[index + 1] !== 'string' || nextArgv[index + 1].startsWith('--')) {
      throw new Error('Replay rerun.argv --evidence-root requires a value.');
    }
    nextArgv[index + 1] = evidenceRoot;
    return nextArgv;
  }
  if (nextArgv[index] === '--evidence-root=') {
    throw new Error('Replay rerun.argv --evidence-root requires a value.');
  }
  nextArgv[index] = `--evidence-root=${evidenceRoot}`;
  return nextArgv;
}

function hasOnlyEvidenceRootChanged(originalArgv, replayArgv) {
  if (originalArgv.length !== replayArgv.length) return false;
  return JSON.stringify(maskEvidenceRootArgv(originalArgv)) ===
    JSON.stringify(maskEvidenceRootArgv(replayArgv));
}

function maskEvidenceRootArgv(argv) {
  const masked = [...argv];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === '--evidence-root' && index + 1 < masked.length) {
      masked[index + 1] = '<evidence-root>';
      index += 1;
      continue;
    }
    if (masked[index].startsWith('--evidence-root=')) {
      masked[index] = '--evidence-root=<evidence-root>';
    }
  }
  return masked;
}

try {
  await main();
} catch (error) {
  console.error(`error: ${error.message}`);
  const fallback = path.resolve(DEFAULT_EVIDENCE_BASE, 'failure-' + createRunId());
  await writeJson(path.join(fallback, 'failure.json'), {
    status: 'FAIL',
    reason: error.message,
    stack: error.stack,
  });
  console.error(`Failure evidence: ${fallback}`);
  process.exitCode = 1;
}
