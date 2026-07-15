#!/usr/bin/env node
/* eslint-disable no-console */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { WORKSPACE_DIR } from './lib/workspace-paths.mjs';

const DEFAULT_EVIDENCE_ROOT = `${WORKSPACE_DIR}/evidence/superliora-preflight-refresh`;
const DEFAULT_RUNTIME_EVIDENCE_ROOT = `${WORKSPACE_DIR}/evidence/preflight-readiness`;
const DEFAULT_EVIDENCE_SEARCH_ROOT = `${WORKSPACE_DIR}/evidence`;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN_FILES = 200;
const MAX_DISCOVERY_SCAN_FILES = 2000;

const CHANNELS = [
  {
    id: 'llmWiki',
    label: 'LLM-wiki',
    pathPattern: /llm[-_ ]?wiki|durable[-_ ]?memory|memory/i,
    textPattern: /llm[-_ ]?wiki|durable memory|liora recall|memory readiness/i,
  },
  {
    id: 'knowledgeMap',
    label: 'knowledge-map',
    pathPattern: /knowledge[-_ ]?map|kimi[-_ ]?context|codegraph|graph/i,
    textPattern: /liora knowledge map|compact project knowledge map|relationship_confidence|path_affected_questions|EXTRACTED, INFERRED, or AMBIGUOUS/i,
  },
  {
    id: 'browserUse',
    label: 'browser-use',
    pathPattern: /browser[-_ ]?use|browser/i,
    textPattern: /browser[-_ ]?use|browser context|screenshot|playwright/i,
  },
  {
    id: 'computerUse',
    label: 'computer-use',
    pathPattern: /computer[-_ ]?use|app[-_ ]?state/i,
    textPattern: /computer[-_ ]?use|mcp__computer_use|get_app_state|app-state/i,
  },
];

function usage() {
  return `Usage: node scripts/liora-preflight-refresh.mjs [options]

Runs the SuperLiora preflight refresh harness.

Options:
  --help                         Show this help.
  --workdir <dir>                Workspace whose runtime evidence is audited. Default: .
  --evidence-root <dir>          Output directory. Default: ${DEFAULT_EVIDENCE_ROOT}
  --runtime-evidence-root <dir>  Runtime evidence root, relative to --workdir unless absolute.
                                  Default: ${DEFAULT_RUNTIME_EVIDENCE_ROOT}
  --evidence-search-root <dir>   Read-only root for existing runtime evidence candidates.
                                  Default: ${DEFAULT_EVIDENCE_SEARCH_ROOT}
  --max-age-ms <n>               Freshness window. Default: ${DEFAULT_MAX_AGE_MS}
  --expect-status <PASS|BLOCKED|FAIL>
                                  Fail if final status differs.
  --note <text>                  Optional redacted note copied into summary.

Examples:
  node scripts/liora-preflight-refresh.mjs
  node scripts/liora-preflight-refresh.mjs --runtime-evidence-root .superliora/evidence/preflight-readiness
`;
}

function main() {
  const startedMs = Date.now();
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) console.error(`error: ${error}`);
    console.error('Run with --help for usage.');
    process.exitCode = 1;
    return;
  }
  if (parsed.options.help) {
    console.log(usage());
    return;
  }

  const startedAt = new Date().toISOString();
  const repoRoot = resolveRepoRoot();
  const workDir = path.resolve(parsed.options.workDir);
  const evidenceRoot = path.resolve(repoRoot, parsed.options.evidenceRoot);
  const benchEvidenceRoot = path.join(evidenceRoot, 'bench');
  const runtimeEvidenceRoot = resolveMaybeRelative(workDir, parsed.options.runtimeEvidenceRoot);
  const evidenceSearchRoot = resolveMaybeRelative(workDir, parsed.options.evidenceSearchRoot);
  mkdirSync(evidenceRoot, { recursive: true });

  const commandsPath = path.join(evidenceRoot, 'commands.jsonl');
  writeFileSync(commandsPath, '');

  const benchResult = runCommand(process.execPath, [
    'scripts/liora-agent-bench.mjs',
    '--suite',
    'seed',
    '--runner',
    'fixture',
    '--evidence-root',
    benchEvidenceRoot,
    '--expect-status',
    'PASS',
  ], repoRoot);
  appendJsonl(commandsPath, commandRecord('seed-fixture-benchmark', benchResult));

  const benchSummary = readJson(path.join(benchEvidenceRoot, 'summary.json'));
  const runtimeEvidence = auditWorkspaceEvidence(workDir, parsed.options.maxAgeMs);
  const runtimeEvidenceCandidates = discoverRuntimeEvidenceCandidates({
    evidenceSearchRoot,
    maxAgeMs: parsed.options.maxAgeMs,
    runtimeEvidence,
    runtimeEvidenceRoot,
  });
  const runtimeEvidenceCandidateAction = buildRuntimeEvidenceCandidateAction(
    runtimeEvidenceCandidates,
  );
  const runtimeEvidenceCandidateTarget = runtimeEvidenceCandidateAction === undefined
    ? undefined
    : runtimeEvidenceRoot;
  const runtimeEvidenceCandidateRerunCommand = runtimeEvidenceCandidateAction === undefined
    ? undefined
    : 'node scripts/liora-preflight-refresh.mjs';
  const missingOrStaleRuntimeEvidence = CHANNELS
    .filter((channel) => !isRuntimeChannelReady(runtimeEvidence[channel.id]))
    .map((channel) => ({
      channel: channel.id,
      label: channel.label,
      state: runtimeEvidence[channel.id].state,
      path: runtimeEvidence[channel.id].sourcePath ?? runtimeEvidenceRoot,
      candidatePath: runtimeEvidenceCandidates[channel.id]?.sourcePath,
      candidateState: runtimeEvidenceCandidates[channel.id]?.state,
    }));

  const benchStatus = typeof benchSummary?.status === 'string' ? benchSummary.status : 'UNKNOWN';
  const benchPassed = benchResult.exitCode === 0 && benchStatus === 'PASS';
  const status = benchPassed && missingOrStaleRuntimeEvidence.length === 0
    ? 'PASS'
    : benchResult.exitCode === 0
      ? 'BLOCKED'
      : 'FAIL';
  const reason = status === 'PASS'
    ? 'Preflight refresh passed with fresh benchmark and runtime evidence.'
    : status === 'BLOCKED'
      ? 'Runtime evidence is missing or stale; recapture it before claiming readiness.'
      : 'Benchmark refresh failed; inspect bench evidence.';
  const readinessGates = buildReadinessGates({
    benchPassed,
    benchStatus,
    missingOrStaleRuntimeEvidence,
    runtimeEvidence,
  });

  const summary = redactRecord({
    benchmark: 'superliora-preflight-refresh',
    status,
    reason,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    evidenceRoot,
    benchEvidenceRoot,
    runtimeEvidenceRoot,
    evidenceSearchRoot,
    noWebUiSuccessSurface: true,
    providerCallStarted: false,
    readinessGates,
    note: parsed.options.note,
    bench: {
      status: benchStatus,
      score: readPath(benchSummary, ['metrics', 'score']),
      passRate: readPath(benchSummary, ['metrics', 'passRate']),
      commandExitCode: benchResult.exitCode,
      summaryPath: path.join(benchEvidenceRoot, 'summary.json'),
    },
    runtimeEvidence,
    runtimeEvidenceCandidates,
    runtimeEvidenceCandidateAction,
    runtimeEvidenceCandidateTarget,
    runtimeEvidenceCandidateRerunCommand,
    missingOrStaleRuntimeEvidence,
    secretScan: 'pass',
  });
  const secretScan = containsSecretLike(JSON.stringify(summary)) ? 'fail' : 'pass';
  summary.secretScan = secretScan;

  writeJson(path.join(evidenceRoot, 'summary.json'), summary);
  writeFileSync(path.join(evidenceRoot, 'summary.md'), renderMarkdown(summary), 'utf8');
  appendJsonl(commandsPath, {
    name: 'runtime-evidence-audit',
    status,
    runtimeEvidenceRoot,
    missingOrStaleRuntimeEvidence,
  });

  console.log(`Evidence root: ${evidenceRoot}`);
  console.log(`Status: ${status}`);
  console.log(`Reason: ${reason}`);
  if (missingOrStaleRuntimeEvidence.length > 0) {
    console.log(`Missing/stale runtime evidence: ${missingOrStaleRuntimeEvidence.map((item) => item.label).join(', ')}`);
    const candidateCount = Object.keys(runtimeEvidenceCandidates).length;
    if (candidateCount > 0) {
      console.log(`Existing candidate evidence: ${candidateCount} found`);
      console.log(`Candidate inspect: ${path.join(evidenceRoot, 'summary.md')}`);
      console.log(`Candidate action: ${runtimeEvidenceCandidateAction}`);
      console.log(`Candidate target: ${runtimeEvidenceCandidateTarget}`);
      console.log(`Candidate rerun: ${runtimeEvidenceCandidateRerunCommand}`);
    }
  }

  if (parsed.options.expectStatus !== undefined && status !== parsed.options.expectStatus) {
    console.error(`Expected status ${String(parsed.options.expectStatus)}, got ${status}`);
    process.exitCode = 1;
    return;
  }
  if (parsed.options.expectStatus === undefined && status !== 'PASS') {
    process.exitCode = status === 'BLOCKED' ? 2 : 1;
  }
}

function buildReadinessGates({ benchPassed, benchStatus, missingOrStaleRuntimeEvidence, runtimeEvidence }) {
  const gates = [
    {
      id: 'bench',
      label: 'benchmark',
      ready: benchPassed,
      state: benchPassed ? 'fresh' : benchStatus,
      reason: benchPassed ? 'Seed fixture benchmark passed.' : `Benchmark status ${benchStatus}.`,
    },
    ...CHANNELS.map((channel) => {
      const evidence = runtimeEvidence[channel.id];
      return {
        id: channel.id,
        label: channel.label,
        ready: isRuntimeChannelReady(evidence),
        state: evidence.state,
        reason: evidence.summary,
      };
    }),
  ];
  const blocked = gates
    .filter((gate) => !gate.ready)
    .map((gate) => ({
      id: gate.id,
      label: gate.label,
      state: gate.state,
      reason: gate.reason,
    }));
  const nextAction = !benchPassed
    ? 'inspect_bench_evidence'
    : missingOrStaleRuntimeEvidence.length > 0
      ? 'refresh_runtime_evidence'
      : 'ready';
  return {
    total: gates.length,
    passed: gates.length - blocked.length,
    blocked,
    nextAction,
    gates,
  };
}

function parseArgs(argv) {
  const options = {
    evidenceRoot: DEFAULT_EVIDENCE_ROOT,
    evidenceSearchRoot: DEFAULT_EVIDENCE_SEARCH_ROOT,
    expectStatus: undefined,
    help: false,
    maxAgeMs: DEFAULT_MAX_AGE_MS,
    note: undefined,
    runtimeEvidenceRoot: DEFAULT_RUNTIME_EVIDENCE_ROOT,
    workDir: '.',
  };
  const errors = [];
  const valueOptions = new Set([
    '--workdir',
    '--evidence-root',
    '--evidence-search-root',
    '--runtime-evidence-root',
    '--max-age-ms',
    '--expect-status',
    '--note',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inlineValue] = splitOption(raw);
    if (flag === '--help') {
      if (inlineValue !== undefined) errors.push('--help does not accept a value');
      else options.help = true;
      continue;
    }
    if (!valueOptions.has(flag)) {
      errors.push(`Unknown option: ${raw}`);
      continue;
    }
    const next = readValueOption(argv, index, inlineValue);
    index = next.index;
    if (next.error !== undefined) {
      errors.push(next.error);
      continue;
    }
    setOption(options, flag, next.value);
  }

  if (!Number.isInteger(options.maxAgeMs) || options.maxAgeMs < 1_000) {
    errors.push('--max-age-ms must be an integer >= 1000');
  }
  if (
    options.expectStatus !== undefined
    && !['PASS', 'BLOCKED', 'FAIL'].includes(options.expectStatus)
  ) {
    errors.push('--expect-status must be one of: PASS, BLOCKED, FAIL');
  }
  return { errors, options };
}

function setOption(options, flag, value) {
  if (flag === '--workdir') options.workDir = value;
  if (flag === '--evidence-root') options.evidenceRoot = value;
  if (flag === '--evidence-search-root') options.evidenceSearchRoot = value;
  if (flag === '--runtime-evidence-root') options.runtimeEvidenceRoot = value;
  if (flag === '--max-age-ms') options.maxAgeMs = Number(value);
  if (flag === '--expect-status') options.expectStatus = value;
  if (flag === '--note') options.note = value;
}

function splitOption(raw) {
  if (!raw.startsWith('--')) return [raw, undefined];
  const equalsIndex = raw.indexOf('=');
  if (equalsIndex === -1) return [raw, undefined];
  return [raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1)];
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

function resolveRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status === 0 && result.stdout.trim() !== '') return path.resolve(result.stdout.trim());
  return path.resolve(process.cwd());
}

function resolveMaybeRelative(root, target) {
  return path.isAbsolute(target) ? target : path.resolve(root, target);
}

function runCommand(command, args, cwd) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  return {
    command,
    args,
    cwd,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

function commandRecord(name, result) {
  return redactRecord({
    name,
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  });
}

function isRuntimeChannelReady(evidence) {
  if (evidence.state === 'missing') return false;
  if (evidence.verified === false) return false;
  return evidence.state === 'fresh';
}

function auditWorkspaceEvidence(workDir, maxAgeMs) {
  const evidenceRoot = path.join(workDir, WORKSPACE_DIR, 'evidence');
  const wikiRoot = path.join(workDir, WORKSPACE_DIR, 'wiki');
  const nowMs = Date.now();
  return Object.fromEntries(CHANNELS.map((channel) => [
    channel.id,
    evaluateRuntimeChannel(channel, { workDir, evidenceRoot, wikiRoot, nowMs, maxAgeMs }),
  ]));
}

function evaluateRuntimeChannel(channel, context) {
  if (channel.id === 'llmWiki') return evaluateLlmWikiChannel(context);
  if (channel.id === 'knowledgeMap') return evaluateKnowledgeMapChannel(context);
  return evaluateCapabilityChannel(channel, context);
}

function evaluateLlmWikiChannel({ _workDir, evidenceRoot, wikiRoot, nowMs, maxAgeMs }) {
  const manifestPath = path.join(wikiRoot, 'manifest.json');
  const indexPath = path.join(wikiRoot, 'index.md');
  const manifest = readJson(manifestPath);
  if (manifest?.kind === 'llm-wiki-manifest' && existsSync(indexPath) && Array.isArray(manifest.runs)) {
    const latest = manifest.runs.find((run) => run.runId === manifest.latestRunId);
    const evidenceState = latest?.evidenceState ?? 'seed';
    if (evidenceState !== 'verified') {
      return {
        ready: false,
        fresh: false,
        verified: false,
        tier: 'seed',
        state: 'seed',
        matchCount: 1,
        sourcePath: indexPath,
        summary: 'LLM-wiki seed only; run /memory verify or promote evidenceState to verified.',
      };
    }
    return freshnessFromSource(indexPath, nowMs, maxAgeMs, {
      verified: true,
      tier: 'verified',
      matchCount: 1,
      label: 'LLM-wiki',
    });
  }

  const legacy = findLegacyEvidenceMatches(evidenceRoot, wikiRoot, /llm[-_ ]?wiki|durable[-_ ]?memory|memory/i, /llm[-_ ]?wiki|durable memory|liora recall|memory readiness/i);
  if (legacy === undefined) {
    return missingChannelEvidence('LLM-wiki');
  }
  return freshnessFromSource(legacy.file, nowMs, maxAgeMs, {
    verified: true,
    tier: 'legacy',
    matchCount: legacy.matchCount,
    label: 'LLM-wiki',
  });
}

function evaluateKnowledgeMapChannel({ evidenceRoot, wikiRoot, nowMs, maxAgeMs }) {
  const files = collectEvidenceFiles(evidenceRoot, wikiRoot, MAX_DISCOVERY_SCAN_FILES)
    .map((file) => ({ file, text: readText(file) }))
    .filter(({ file, text }) => /knowledge[-_ ]?map|liora-knowledge-map/i.test(file) || /liora knowledge map|relationship_confidence|path_affected_questions/i.test(text));

  if (files.length === 0) return missingChannelEvidence('knowledge-map');

  const ranked = files
    .map(({ file, text }) => ({
      file,
      text,
      tier: resolveKnowledgeMapTier(text),
      mtimeMs: statSync(file).mtimeMs,
    }))
    .toSorted((a, b) => {
      const tierRank = { verified: 3, legacy: 2, seed: 1, missing: 0 };
      const rankDiff = (tierRank[b.tier] ?? 0) - (tierRank[a.tier] ?? 0);
      return rankDiff !== 0 ? rankDiff : b.mtimeMs - a.mtimeMs;
    });
  const best = ranked[0];
  if (best === undefined) return missingChannelEvidence('knowledge-map');
  if (best.tier === 'seed') {
    return {
      ready: false,
      fresh: false,
      verified: false,
      tier: 'seed',
      state: 'seed',
      matchCount: files.length,
      sourcePath: best.file,
      summary: 'Knowledge-map seed only; run /memory verify or set evidenceState to verified.',
    };
  }
  return freshnessFromSource(best.file, nowMs, maxAgeMs, {
    verified: true,
    tier: best.tier,
    matchCount: files.length,
    label: 'knowledge-map',
  });
}

function evaluateCapabilityChannel(channel, { evidenceRoot, wikiRoot, nowMs, maxAgeMs }) {
  const files = collectEvidenceFiles(evidenceRoot, wikiRoot, MAX_DISCOVERY_SCAN_FILES)
    .map((file) => ({ file, text: readText(file) }))
    .filter(({ file, text }) =>
      (channel.pathPattern.test(file) || channel.textPattern.test(text))
      && hasEvidenceProof(text));
  if (files.length === 0) return missingChannelEvidence(channel.label);
  const newest = files
    .map(({ file }) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return freshnessFromSource(newest.file, nowMs, maxAgeMs, {
    verified: true,
    tier: 'verified',
    matchCount: files.length,
    label: channel.label,
  });
}

function freshnessFromSource(sourcePath, nowMs, maxAgeMs, extra) {
  const ageMs = Math.max(0, nowMs - statSync(sourcePath).mtimeMs);
  const fresh = ageMs <= maxAgeMs;
  return {
    ready: fresh && extra.verified !== false,
    fresh,
    verified: extra.verified !== false,
    tier: extra.tier,
    state: fresh ? 'fresh' : 'stale',
    ageMs,
    matchCount: extra.matchCount,
    sourcePath,
    summary: `${extra.label} evidence ${fresh ? 'fresh' : 'stale'}.`,
  };
}

function missingChannelEvidence(label) {
  return {
    ready: false,
    fresh: false,
    verified: false,
    tier: 'missing',
    state: 'missing',
    matchCount: 0,
    summary: `No ${label} evidence found.`,
  };
}

function resolveKnowledgeMapTier(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.evidenceState === 'verified') return 'verified';
    if (parsed.evidenceState === 'seed') return 'seed';
    if (/\bPASS\b/u.test(text)) return 'verified';
    if (Array.isArray(parsed.relationship_confidence) && parsed.relationship_confidence.length > 0) return 'verified';
    if (parsed.kind === 'liora knowledge map') return 'seed';
  } catch {
    // Fall through to legacy classification.
  }
  return 'legacy';
}

function findLegacyEvidenceMatches(evidenceRoot, wikiRoot, pathPattern, textPattern) {
  const files = collectEvidenceFiles(evidenceRoot, wikiRoot, MAX_DISCOVERY_SCAN_FILES)
    .map((file) => ({ file, text: readText(file) }))
    .filter(({ file, text }) => pathPattern.test(file) || textPattern.test(text));
  if (files.length === 0) return undefined;
  const newest = files
    .map(({ file }) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return { file: newest.file, matchCount: files.length };
}

function collectEvidenceFiles(evidenceRoot, wikiRoot, maxFiles) {
  const files = [];
  if (existsSync(evidenceRoot)) visit(evidenceRoot, files, maxFiles);
  return files.filter((file) => !file.startsWith(`${wikiRoot}${path.sep}`));
}

function hasEvidenceProof(text) {
  return /\b(?:PASS|passed|status|screenshot|transcript|action log|observation|validator|cleanup)\b/i.test(text);
}

function _auditRuntimeEvidence(root, maxAgeMs) {
  const files = collectFiles(root, MAX_SCAN_FILES);
  const nowMs = Date.now();
  return Object.fromEntries(CHANNELS.map((channel) => {
    const matches = files
      .map((file) => ({ file, text: readText(file) }))
      .filter(({ file, text }) => channel.pathPattern.test(file) || channel.textPattern.test(text));
    if (matches.length === 0) {
      return [channel.id, {
        ready: false,
        fresh: false,
        state: 'missing',
        matchCount: 0,
        summary: `No ${channel.label} evidence found.`,
      }];
    }
    const newest = matches
      .map(({ file }) => ({ file, mtimeMs: statSync(file).mtimeMs }))
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
    const ageMs = Math.max(0, nowMs - newest.mtimeMs);
    const fresh = ageMs <= maxAgeMs;
    return [channel.id, {
      ready: fresh,
      fresh,
      state: fresh ? 'fresh' : 'stale',
      ageMs,
      matchCount: matches.length,
      sourcePath: newest.file,
      summary: `${channel.label} evidence ${fresh ? 'fresh' : 'stale'}.`,
    }];
  }));
}

function discoverRuntimeEvidenceCandidates({
  evidenceSearchRoot,
  maxAgeMs,
  runtimeEvidence,
  runtimeEvidenceRoot,
}) {
  if (!existsSync(evidenceSearchRoot)) return {};
  const nowMs = Date.now();
  const files = collectFiles(evidenceSearchRoot, MAX_DISCOVERY_SCAN_FILES)
    .filter((file) => !file.startsWith(`${runtimeEvidenceRoot}${path.sep}`));
  return Object.fromEntries(CHANNELS.flatMap((channel) => {
    if (isRuntimeChannelReady(runtimeEvidence[channel.id])) return [];
    const matches = files
      .map((file) => ({ file, text: readText(file) }))
      .filter(({ file, text }) => channel.pathPattern.test(file) || channel.textPattern.test(text));
    if (matches.length === 0) return [];
    const newest = matches
      .map(({ file }) => ({ file, mtimeMs: statSync(file).mtimeMs }))
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
    const ageMs = Math.max(0, nowMs - newest.mtimeMs);
    return [[channel.id, {
      state: ageMs <= maxAgeMs ? 'fresh' : 'stale',
      ageMs,
      matchCount: matches.length,
      sourcePath: newest.file,
      summary: `Found ${channel.label} candidate evidence outside the readiness root.`,
    }]];
  }));
}

function buildRuntimeEvidenceCandidateAction(runtimeEvidenceCandidates) {
  const count = Object.keys(runtimeEvidenceCandidates).length;
  if (count === 0) return undefined;
  const noun = count === 1 ? 'candidate' : 'candidates';
  return `recapture ${count} ${noun}`;
}

function collectFiles(root, maxFiles) {
  if (!existsSync(root)) return [];
  const files = [];
  visit(root, files, maxFiles);
  return files;
}

function visit(target, files, maxFiles) {
  if (files.length >= maxFiles) return;
  const stat = safeStat(target);
  if (stat === undefined) return;
  if (stat.isFile()) {
    files.push(target);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(target)) {
    visit(path.join(target, entry), files, maxFiles);
    if (files.length >= maxFiles) return;
  }
}

function safeStat(target) {
  try {
    return statSync(target);
  } catch {
    return undefined;
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8').slice(0, 200_000);
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function readPath(record, segments) {
  let current = record;
  for (const segment of segments) current = current?.[segment];
  return current;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(redactRecord(value), null, 2)}\n`, 'utf8');
}

function appendJsonl(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(redactRecord(value))}\n`, { flag: 'a' });
}

function renderMarkdown(summary) {
  const runtimeRows = CHANNELS.map((channel) => {
    const evidence = summary.runtimeEvidence[channel.id];
    return `| ${channel.label} | ${evidence.state} | ${evidence.sourcePath ?? summary.runtimeEvidenceRoot} |`;
  }).join('\n');
  const candidateRows = CHANNELS
    .map((channel) => {
      const candidate = summary.runtimeEvidenceCandidates[channel.id];
      if (candidate === undefined) return undefined;
      return `| ${channel.label} | ${candidate.state} | ${candidate.sourcePath} |`;
    })
    .filter((row) => row !== undefined)
    .join('\n');
  const candidateSection = candidateRows.length === 0
    ? ''
    : `\nCandidate runtime evidence found outside readiness root:\n\nAction: ${summary.runtimeEvidenceCandidateAction}\nTarget: ${summary.runtimeEvidenceCandidateTarget}\nRerun: ${summary.runtimeEvidenceCandidateRerunCommand}\n\n| channel | state | source |\n|---|---|---|\n${candidateRows}\n`;
  const blocked = summary.readinessGates.blocked.length === 0
    ? 'none'
    : summary.readinessGates.blocked.map((gate) => gate.id).join(',');
  return `# SuperLiora Preflight Refresh

Status: ${summary.status}

Reason: ${summary.reason}

Readiness gates: ${summary.readinessGates.passed}/${summary.readinessGates.total}; blocked ${blocked}; next ${summary.readinessGates.nextAction}

| channel | state | source |
|---|---|---|
| benchmark | ${summary.bench.status} | ${summary.bench.summaryPath} |
${runtimeRows}
${candidateSection}
`;
}

function redactRecord(value) {
  if (Array.isArray(value)) return value.map(redactRecord);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? '<redacted>' : redactRecord(entry),
    ]));
  }
  if (typeof value === 'string') return redactText(value);
  return value;
}

function isSensitiveKey(key) {
  return /(?:^|[_\-.])(?:api[_-]?key|token|secret|password|oauth|bearer|auth|client[_-]?secret)(?:$|[_\-.])/i
    .test(key);
}

function redactText(value) {
  return String(value ?? '')
    .replaceAll(/sk-[A-Za-z0-9_-]{8,}/g, '<redacted>')
    .replaceAll(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\b/g, '<redacted-env>')
    .replaceAll(/([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_.-]*\s*[:=]\s*)[^\s"',;]+/gi, '$1<redacted>')
    .slice(0, 50_000);
}

function containsSecretLike(value) {
  return /(sk-[A-Za-z0-9_-]{8,}|secret-value|KIMI_MODEL_API_KEY|OPENAI_API_KEY)/i.test(value);
}

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  const fallback = path.resolve(DEFAULT_EVIDENCE_ROOT, `failure-${randomUUID().slice(0, 8)}`);
  writeJson(path.join(fallback, 'failure.json'), {
    status: 'FAIL',
    reason: error.message,
    stack: error.stack,
  });
  process.exitCode = 1;
}
