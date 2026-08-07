import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { resolveEvidenceRoot } from '#/constant/workspace-data';
import type { StatusRecoveryReadiness } from '../../components/messages/status-panel/index';

interface SotaRecoveryCandidate {
  readonly path: string;
  readonly mtimeMs: number;
}

const SOTA_SUMMARY_FILENAME = 'sota-gate-summary.json';
const SOTA_RECOVERY_SCAN_MAX_DEPTH = 5;
const SOTA_RECOVERY_SCAN_LIMIT = 2_000;

export function loadStatusRecoveryReadiness(workDir: string): StatusRecoveryReadiness {
  const evidenceRoot = join(workDir, resolveEvidenceRoot(workDir));
  const latest = latestPassingSotaRecoveryEvidence(evidenceRoot);
  if (latest === undefined) {
    return {
      ready: false,
      nextAction: 'Run live TUI SOTA gate to capture recovery evidence.',
    };
  }
  return {
    ready: true,
    evidencePath: displayStatusEvidencePath(workDir, latest.path),
    nextAction: 'Recovery evidence ready.',
  };
}

function latestPassingSotaRecoveryEvidence(root: string): SotaRecoveryCandidate | undefined {
  if (!existsSync(root)) return undefined;
  const candidates: SotaRecoveryCandidate[] = [];
  collectPassingSotaRecoveryEvidence(root, 0, { visited: 0 }, candidates);
  return candidates.toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function collectPassingSotaRecoveryEvidence(
  dir: string,
  depth: number,
  state: { visited: number },
  candidates: SotaRecoveryCandidate[],
): void {
  if (state.visited >= SOTA_RECOVERY_SCAN_LIMIT || depth > SOTA_RECOVERY_SCAN_MAX_DEPTH) return;
  state.visited += 1;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPassingSotaRecoveryEvidence(entryPath, depth + 1, state, candidates);
      continue;
    }
    if (!entry.isFile() || entry.name !== SOTA_SUMMARY_FILENAME) continue;
    const summary = readStatusJsonRecord(entryPath);
    if (summary === undefined || !isPassingSotaRecoverySummary(summary)) continue;
    candidates.push({ path: entryPath, mtimeMs: fileMtimeMs(entryPath) });
  }
}

function isPassingSotaRecoverySummary(summary: Record<string, unknown>): boolean {
  return (
    summary['status'] === 'PASS' &&
    statusField(summary['tuiWorkflowProof']) === 'PASS' &&
    statusField(summary['harnessRadarGate']) === 'PASS'
  );
}

function statusField(value: unknown): string | undefined {
  return isRecord(value) && typeof value['status'] === 'string' ? value['status'] : undefined;
}

function readStatusJsonRecord(path: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function displayStatusEvidencePath(workDir: string, path: string): string {
  const rel = relative(workDir, path);
  return rel.length > 0 && !rel.startsWith('..') ? rel : path;
}
