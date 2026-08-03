#!/usr/bin/env node
/**
 * V2-4 await scan — ratchet gate for hot-path await violations in the job family.
 *
 * Scans every .ts file under two roots (recursive):
 *   - packages/agent-core/src/tools/builtin/job
 *   - packages/agent-core/src/session/job
 *
 * Two lanes:
 *   - worker lane: `await launchJobWorker | scheduleQueuedJobs` — the
 *     interactive lane must never wait on worker spawn/schedule results.
 *     Hard cap 0 (V2-1 + V2-2 wiring: offload pump + WorkerSpawner).
 *     The designated background sink `src/session/job/job-offload.ts` is
 *     exempt (it IS the offload lane the awaits moved into); the exemption
 *     is ratcheted: the file must keep at least one such await, otherwise
 *     the exemption is stale and the gate fails.
 *   - merge lane: `await landJobToMain` — the interactive lane must never
 *     run a git merge. V2-5 offloaded execution to a kind=merge landing job;
 *     the lane is ratcheted to 0. The designated merge sink
 *     `dispatchMergeLand` in `src/tools/builtin/job/job-land.ts` is exempt
 *     (it IS the offload lane the merge awaits moved into); the exemption is
 *     ratcheted: the file must keep at least one such await, otherwise the
 *     exemption is stale and the gate fails.
 *
 * Exit code: 1 when the worker lane exceeds 0, the merge lane exceeds its
 * baseline, or the combined total exceeds the legacy baseline. Lower the
 * baselines as violations are removed; never raise them without a gate
 * decision.
 *
 * BASELINE history:
 *   9 — measured on the pre-wiring tree (4x launchJobWorker, 4x
 *       scheduleQueuedJobs, 1x landJobToMain). The earlier "6" estimate
 *       (reports/2026-08-03-v2-gate-evidence.md) predated counting
 *       scheduleQueuedJobs awaits.
 *   post-wiring — worker lane 0 (launchJobWorker/scheduleQueuedJobs removed
 *       from every ACK/completion path); merge lane 1 (landJobToMain, V2-5
 *       residual). The combined legacy baseline stays 9 until V2-5 lands,
 *       keeping the await-scan gate test's tripwire intact.
 *   V2-5 — merge lane 0: MergeJob returns the trust verdict only; the land
 *       runs on a kind=merge landing job (dispatchMergeLand, job-land.ts).
 *       Combined baseline lowered to 0 — both lanes clean.
 *
 * Usage (from the repository root):
 *   node scripts/check-await-scan.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const LEGACY_BASELINE = 0;
const MERGE_BASELINE = 0;
const WORKER_CAP = 0;

/** Designated background sink for worker spawn/schedule awaits (repo-relative). */
const OFFLOAD_SINK = 'packages/agent-core/src/session/job/job-offload.ts';
/** Designated offload sink for merge land awaits (repo-relative, V2-5). */
const MERGE_SINK = 'packages/agent-core/src/tools/builtin/job/job-land.ts';

const WORKER_PATTERN = /(await\s+(launchJobWorker|scheduleQueuedJobs))\b/g;
const MERGE_PATTERN = /(await\s+landJobToMain)\b/g;

const repoRoot = process.cwd();
const scanRoots = [
  join(repoRoot, 'packages', 'agent-core', 'src', 'tools', 'builtin', 'job'),
  join(repoRoot, 'packages', 'agent-core', 'src', 'session', 'job'),
];

async function collectTypeScriptFiles(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTypeScriptFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

const files = [];
for (const root of scanRoots) {
  files.push(...(await collectTypeScriptFiles(root)));
}
console.log(
  `await-scan: roots=${scanRoots.map((r) => relative(repoRoot, r)).join(',')}`,
);
// Coverage proof: every scanned file is listed, so a clean (violation-free)
// file like job-tools.ts still appears in the gate output.
console.log(
  `await-scan: scanned=${files.map((f) => relative(repoRoot, f)).join(',')}`,
);

let workerTotal = 0;
let mergeTotal = 0;
let sinkTotal = 0;
let mergeSinkTotal = 0;

for (const file of files) {
  const rel = relative(repoRoot, file);
  const content = await readFile(file, 'utf8');
  for (const [pattern, lane] of [
    [WORKER_PATTERN, 'worker'],
    [MERGE_PATTERN, 'merge'],
  ]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const text = match[1].replaceAll(/\s+/g, ' ');
      const exemptSink = lane === 'worker' && rel === OFFLOAD_SINK;
      const exemptMergeSink = lane === 'merge' && rel === MERGE_SINK;
      console.log(
        `${rel}:${line}: ${text} [${exemptSink ? 'offload-sink' : exemptMergeSink ? 'merge-sink' : lane}]`,
      );
      if (lane === 'merge') {
        if (exemptMergeSink) mergeSinkTotal += 1;
        else mergeTotal += 1;
      } else if (exemptSink) sinkTotal += 1;
      else workerTotal += 1;
    }
  }
}

const total = workerTotal + mergeTotal;
const workerOk = workerTotal <= WORKER_CAP;
const mergeOk = mergeTotal <= MERGE_BASELINE;
const legacyOk = total <= LEGACY_BASELINE;
// The exemption only stays valid while the sink is genuinely the offload
// lane; an empty sink means the exemption is stale.
const sinkOk = sinkTotal >= 1;
const mergeSinkOk = mergeSinkTotal >= 1;

console.log(
  `await-scan: worker-lane violations=${workerTotal} cap=${WORKER_CAP} status=${workerOk ? 'OK' : 'FAIL'}`,
);
console.log(
  `await-scan: offload-sink violations=${sinkTotal} min=1 (${OFFLOAD_SINK}) status=${sinkOk ? 'OK' : 'FAIL'}`,
);
console.log(
  `await-scan: merge-sink violations=${mergeSinkTotal} min=1 (${MERGE_SINK}) status=${mergeSinkOk ? 'OK' : 'FAIL'}`,
);
console.log(
  `await-scan: merge-lane violations=${mergeTotal} baseline=${MERGE_BASELINE} status=${mergeOk ? 'OK' : 'FAIL'}`,
);
console.log(
  `await-scan: violations=${total} baseline=${LEGACY_BASELINE} status=${legacyOk ? 'OK' : 'FAIL'}`,
);
if (!workerOk || !mergeOk || !legacyOk || !sinkOk || !mergeSinkOk) {
  process.exit(1);
}
