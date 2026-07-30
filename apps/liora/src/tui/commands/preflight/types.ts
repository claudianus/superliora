import { workspaceRelativePath, CANONICAL_EVIDENCE_ROOT, WORKSPACE_DATA_DIR } from '#/constant/workspace-data';

import type { BenchStatus } from '../bench/bench';
import type { MemoryReadinessSnapshot } from '../evidence-readiness';

export const DEFAULT_PREFLIGHT_RECALL_QUERY = 'superliora harness knowledge-map browser-use computer-use llm-wiki readiness';
export const PREFLIGHT_RECALL_MEMORY_SUBJECT = 'preflight-readiness';
export const PREFLIGHT_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PREFLIGHT_REFRESH_COMMAND = 'node scripts/liora-preflight-refresh.mjs';
export const PREFLIGHT_BENCH_LOOP_COMMAND = 'node scripts/liora-agent-bench.mjs --loop --max-iterations 2';
export const PREFLIGHT_BENCH_LOOP_MAX_ITERATIONS = 2;
export const PREFLIGHT_BENCH_LOOP_MAX_TOTAL_MS = 600_000;
export const PREFLIGHT_ULTRAWORK_CONTRACT_PATH = 'apps/liora/src/tui/commands/ultrawork/ultrawork-contract.ts';

export const CANONICAL_PREFLIGHT_REFRESH_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/superliora-preflight-refresh`;
export const CANONICAL_PREFLIGHT_RUNTIME_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/preflight-readiness`;
export const CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/liora-agent-bench`;
export const CANONICAL_SOTA_CRITERIA_PATH = `${WORKSPACE_DATA_DIR}/bench/sota-criteria.json`;

export function preflightRefreshEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence', 'superliora-preflight-refresh');
}

export function preflightBenchLoopEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence', 'liora-agent-bench');
}

export function preflightSotaCriteriaPath(workDir: string): string {
  return workspaceRelativePath(workDir, 'bench', 'sota-criteria.json');
}

export const HUMAN_WRITING_CONTRACT_PHRASES = [
  'Human Writing / Anti-Slop',
  'not a bottleneck on code',
  'light pass',
  'Dynamic routing',
  'response language',
  'Locale-specific skills are discovered via SearchSkill',
  'never assume a default language',
  'surface-specific voice lane',
  'plain specific claims, concrete nouns and verbs',
  'source-backed details',
  'self-audit for template openings',
  'avoid-ai-writing style checks',
  'Do not treat AI-writing detectors as truth',
  'never use detector signals to accuse an author',
  'deterministic unslop cleanup only as advisory pattern checks',
  'reread for changed meaning',
] as const;

export const HUMAN_WRITING_RUBRIC_PHRASES = [
  'quality gate for user-facing prose',
  'light pass',
  'Dynamic routing',
  'response language',
  'Locale-specific skills are discovered',
  'surface-specific voice lane',
  'plain specific claims',
  'source-backed details',
  'Self-audit for template openings',
  'avoid-ai-writing checks',
  'Do not treat AI-writing detectors as truth',
  'accuse an author',
  'second-pass rewrite or deterministic cleanup',
  'reread for changed meaning',
] as const;

type PreflightFreshnessState = 'fresh' | 'stale' | 'missing';

export interface PreflightFreshnessSignal {
  readonly state: PreflightFreshnessState;
  readonly ageMs?: number;
  readonly sourcePath?: string;
}

export interface PreflightFreshness {
  readonly ready: boolean;
  readonly windowMs: number;
  readonly bench: PreflightFreshnessSignal;
  readonly llmWiki: PreflightFreshnessSignal;
  readonly knowledgeMap: PreflightFreshnessSignal;
  readonly browserUse: PreflightFreshnessSignal;
  readonly computerUse: PreflightFreshnessSignal;
}

export interface PreflightRefreshPlan {
  readonly needed: boolean;
  readonly reason: string;
  readonly command: string;
  readonly evidencePath: string;
  readonly runtimeEvidencePath: string;
}

export interface PreflightRefreshRun {
  readonly status: string;
  readonly evidencePath: string;
  readonly durationMs?: number;
  readonly completedAt?: string;
  readonly bench?: PreflightRefreshBench;
  readonly readinessGates?: PreflightRefreshGates;
  readonly runtimeCandidates: readonly PreflightRuntimeCandidate[];
  readonly missingChannels: readonly string[];
  readonly warning?: string;
}

export interface PreflightRuntimeCandidate {
  readonly channel: string;
  readonly state: string;
  readonly sourcePath: string;
}

export interface PreflightRefreshGates {
  readonly total?: number;
  readonly passed?: number;
  readonly blocked: readonly string[];
  readonly nextAction?: string;
}

export interface PreflightRefreshBench {
  readonly score?: number;
  readonly passRate?: number;
  readonly scored?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly blocked?: number;
  readonly quarantined?: number;
  readonly wallClockMs?: number;
  readonly estimatedTokens?: number;
  readonly commandCount?: number;
}

export interface PreflightLoopRun {
  readonly status: string;
  readonly evidencePath: string;
  readonly evidenceRoot?: string;
  readonly rerunCommand?: string;
  readonly completedAt?: string;
  readonly evidenceMtimeMs?: number;
  readonly stopReason?: string;
  readonly bestScore?: number;
  readonly firstScore?: number;
  readonly lastScore?: number;
  readonly iterations?: number;
  readonly maxIterations?: number;
  readonly selected?: number;
  readonly scored?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly blocked?: number;
  readonly quarantined?: number;
  readonly quarantineTask?: string;
  readonly quarantineFindings?: readonly string[];
  readonly proposal?: string;
  readonly warning?: string;
}

export interface PreflightHumanWriting {
  readonly ready: boolean;
  readonly contractReady: boolean;
  readonly rubricReady: boolean;
  readonly advisoryOnly: boolean;
  readonly contractPath: string;
  readonly rubricPath: string;
  readonly nextAction: string;
  readonly warning?: string;
}

export interface PreflightStatus {
  readonly bench: BenchStatus;
  readonly memory: MemoryReadinessSnapshot;
  readonly freshness: PreflightFreshness;
  readonly humanWriting: PreflightHumanWriting;
  readonly refreshPlan: PreflightRefreshPlan;
  readonly refreshRun?: PreflightRefreshRun;
  readonly loopRun?: PreflightLoopRun;
  readonly ready: boolean;
  readonly nextAction: string;
}

export interface PreflightArgs {
  readonly benchArgs: string;
  readonly query: string;
}

export interface RefreshAgeDetails {
  readonly state: 'fresh' | 'stale';
  readonly ageMs: number;
  readonly horizonMs: number;
}
