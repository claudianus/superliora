import type { Agent } from '../agent';
import { buildUltraworkResumeCursor } from './recovery';
import { detectLongRunningStage, detectStuckWorkGraphNodes, inferEffectiveUltraworkStage, summarizeWorkGraphProgress } from './stage-progress';
import type { UltraworkRunMirror } from './types';

export interface UltraworkEnvelopeOptions {
  readonly compactionBoundary?: boolean;
}

export function buildUltraworkCompactionEnvelope(
  agent: Agent,
  options: UltraworkEnvelopeOptions = {},
): string | undefined {
  const snapshot = captureUltraworkEnvelopeSnapshot(agent, options);
  if (snapshot === undefined) return undefined;
  return renderUltraworkCompactionEnvelope(snapshot);
}

export function captureUltraworkEnvelopeSnapshot(
  agent: Agent,
  options: UltraworkEnvelopeOptions = {},
): UltraworkRunMirror | undefined {
  const ultrawork = agent.ultrawork;
  const run = ultrawork.getRun();
  if (run === null || run.status === 'done' || run.status === 'failed') return undefined;

  const planMode = agent.planMode;
  const planCheckpoint =
    planMode.isActive && planMode.isUltraMode
      ? {
          planFilePath: planMode.planFilePath ?? undefined,
          phase: planMode.phase,
          interviewRoundCount: planMode.interviewRoundCount,
          ultraPlan: planMode.captureStateCheckpoint()?.ultraPlan,
        }
      : undefined;

  const goal = agent.goal.getGoal().goal;
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const resumeCursor = buildUltraworkResumeCursor(agent, run, planCheckpoint);

  return {
    schema: 2,
    run,
    activation: ultrawork.getActivation(),
    interruptReason:
      run.status === 'blocked'
        ? 'Paused during compaction'
        : options.compactionBoundary === true
          ? 'Context compacted; continue from checkpoint'
          : undefined,
    planCheckpoint,
    lastCheckpointAt: run.updatedAt,
    goalStatus: goal?.status,
    effectiveStage,
    compactionBoundary: options.compactionBoundary,
    resumeCursor,
    journalOffset: agent.records.recordCount(),
  };
}

/** Maximum characters for the objective field in the envelope. */
const MAX_ENVELOPE_OBJECTIVE_CHARS = 200;

export function renderUltraworkCompactionEnvelope(snapshot: UltraworkRunMirror): string {
  const objective =
    snapshot.run.objective.length > MAX_ENVELOPE_OBJECTIVE_CHARS
      ? `${snapshot.run.objective.slice(0, MAX_ENVELOPE_OBJECTIVE_CHARS)}…`
      : snapshot.run.objective;
  const lines = [
    '## Ultrawork Run Envelope',
    'ultrawork_envelope:',
    `run_id: ${snapshot.run.id}`,
    `objective: ${objective}`,
    `stage: ${snapshot.run.stage}`,
    `status: ${snapshot.run.status}`,
    `last_updated: ${snapshot.run.updatedAt}`,
  ];

  if (snapshot.compactionBoundary === true) {
    lines.push('compaction_boundary: true');
  }
  if (snapshot.effectiveStage !== undefined && snapshot.effectiveStage !== snapshot.run.stage) {
    lines.push(`effective_stage: ${snapshot.effectiveStage}`);
  }
  if (snapshot.interruptReason !== undefined) {
    lines.push(`interrupt_reason: ${snapshot.interruptReason}`);
  }
  if (snapshot.activation !== undefined) {
    lines.push(`evidence_root: ${snapshot.activation.evidenceRoot}`);
  }
  if (snapshot.planCheckpoint?.planFilePath !== undefined) {
    lines.push(`plan_file: ${snapshot.planCheckpoint.planFilePath}`);
  }
  if (snapshot.planCheckpoint?.phase !== undefined) {
    lines.push(`ultraplan_phase: ${snapshot.planCheckpoint.phase}`);
  }
  if (
    snapshot.planCheckpoint?.interviewRoundCount !== undefined &&
    snapshot.planCheckpoint.interviewRoundCount > 0
  ) {
    lines.push(`interview_rounds_completed: ${String(snapshot.planCheckpoint.interviewRoundCount)}`);
  }
  if (snapshot.goalStatus !== undefined) {
    lines.push(`goal_status: ${snapshot.goalStatus}`);
  }

  const progress = summarizeWorkGraphProgress(snapshot.run.workGraph);
  if (progress.doneCount > 0 || progress.pendingCount > 0) {
    lines.push(
      `workgraph_progress: ${String(progress.doneCount)} done, ${String(progress.pendingCount)} pending`,
    );
  }

  const researchPackCount = snapshot.run.researchRun?.evidencePack !== undefined ? 1 : 0;
  if (researchPackCount > 0) {
    lines.push(`research_evidence_packs: ${String(researchPackCount)}`);
  }

  const teamExperts = snapshot.run.teamPlan?.experts ?? [];
  if (teamExperts.length > 0) {
    const activeExperts = teamExperts.filter((expert) => expert.status !== 'done');
    lines.push(`team_plan_experts: ${String(teamExperts.length)} total, ${String(activeExperts.length)} active`);
    for (const expert of activeExperts.slice(0, 6)) {
      lines.push(`- expert ${expert.id}: ${expert.status}`);
    }
  }

  if (snapshot.resumeCursor !== undefined) {
    lines.push('resume_cursor:');
    lines.push(`- stage: ${snapshot.resumeCursor.stage}`);
    if (snapshot.resumeCursor.planPhase !== undefined) {
      lines.push(`- plan_phase: ${snapshot.resumeCursor.planPhase}`);
    }
    if (
      snapshot.resumeCursor.interviewRound !== undefined &&
      snapshot.resumeCursor.interviewRound > 0
    ) {
      lines.push(`- continue_interview_from_round: ${String(snapshot.resumeCursor.interviewRound + 1)}`);
    }
    if (snapshot.resumeCursor.workGraphNodeId !== undefined) {
      lines.push(`- work_graph_node: ${snapshot.resumeCursor.workGraphNodeId}`);
    }
    if (snapshot.resumeCursor.goalStatus !== undefined) {
      lines.push(`- goal_status: ${snapshot.resumeCursor.goalStatus}`);
    }
  }

  const pendingNodes = snapshot.run.workGraph?.nodes.filter((node) => node.status !== 'done') ?? [];
  if (pendingNodes.length > 0) {
    lines.push(`pending_workgraph_nodes: ${String(pendingNodes.length)}`);
    for (const node of pendingNodes.slice(0, 12)) {
      lines.push(`- [${node.status}] ${node.id}: ${node.title} (stage=${node.stage})`);
    }
  }

  // Highlight stuck nodes so post-compaction resume can circuit-break them.
  const stuckNodes = detectStuckWorkGraphNodes(snapshot.run.workGraph);
  if (stuckNodes.length > 0) {
    lines.push(`stuck_nodes: ${stuckNodes.slice(0, 5).map((n) => `${n.id}[${n.status}]`).join(', ')}`);
  }

  // Flag stages exceeding expected duration (un-bounded loop anti-pattern).
  const longStage = detectLongRunningStage(snapshot.run);
  if (longStage !== undefined) {
    const elapsedMin = Math.round(longStage.elapsedMs / 60_000);
    lines.push(`long_running_stage: ${longStage.stage} ~${String(elapsedMin)}min (threshold ${String(Math.round(longStage.thresholdMs / 60_000))}min)`);
  }

  lines.push(
    'resume_policy: Continue this Ultrawork run from the checkpoint. Do not restart UltraPlan interview, create a new plan file, or open a new Ultrawork run unless the checkpoint is unusable.',
  );
  return lines.join('\n');
}

export function renderUltraworkRunsMemorySection(snapshot: UltraworkRunMirror): string {
  const lines = [
    'ultrawork_runs:',
    `- run_id=${snapshot.run.id} stage=${snapshot.run.stage} status=${snapshot.run.status}`,
  ];
  if (snapshot.effectiveStage !== undefined && snapshot.effectiveStage !== snapshot.run.stage) {
    lines.push(`  effective_stage=${snapshot.effectiveStage}`);
  }
  if (snapshot.resumeCursor?.workGraphNodeId !== undefined) {
    lines.push(`  resume_node=${snapshot.resumeCursor.workGraphNodeId}`);
  }
  const progress = summarizeWorkGraphProgress(snapshot.run.workGraph);
  if (progress.pendingCount > 0) {
    lines.push(`  pending_nodes=${String(progress.pendingCount)}`);
  }
  return lines.join('\n');
}

export function extractUltraworkRunLines(summary: string): readonly string[] {
  const lines: string[] = [];
  let inSection = false;
  for (const line of summary.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'ultrawork_runs:') {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (trimmed.length === 0) break;
      // End when a new top-level section starts (non-indented key: pattern)
      if (/^[a-z_]+:/.test(trimmed) && !trimmed.startsWith('-') && !line.startsWith(' ')) break;
      if (trimmed.startsWith('-')) {
        lines.push(trimmed.slice(1).trim());
      } else if (line.startsWith('  ') && trimmed.length > 0) {
        // Indented key=value detail lines (effective_stage, resume_node, etc.)
        lines.push(trimmed);
      }
    }
  }
  return lines;
}
