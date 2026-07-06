import type { Agent } from '../agent';
import type { UltraworkRunMirror } from './types';

export function buildUltraworkCompactionEnvelope(agent: Agent): string | undefined {
  const snapshot = captureUltraworkEnvelopeSnapshot(agent);
  if (snapshot === undefined) return undefined;
  return renderUltraworkCompactionEnvelope(snapshot);
}

export function captureUltraworkEnvelopeSnapshot(agent: Agent): UltraworkRunMirror | undefined {
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
  return {
    schema: 1,
    run,
    activation: ultrawork.getActivation(),
    interruptReason: run.status === 'blocked' ? 'Paused during compaction' : undefined,
    planCheckpoint,
    lastCheckpointAt: run.updatedAt,
    goalStatus: goal?.status,
    resumeCursor: {
      stage: run.stage,
      planPhase: planCheckpoint?.phase,
      interviewRound: planCheckpoint?.interviewRoundCount,
      goalStatus: goal?.status,
    },
  };
}

function renderUltraworkCompactionEnvelope(snapshot: UltraworkRunMirror): string {
  const lines = [
    '## Ultrawork Run Envelope',
    'ultrawork_envelope:',
    `run_id: ${snapshot.run.id}`,
    `objective: ${snapshot.run.objective}`,
    `stage: ${snapshot.run.stage}`,
    `status: ${snapshot.run.status}`,
    `last_updated: ${snapshot.run.updatedAt}`,
  ];

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

  const pendingNodes = snapshot.run.workGraph?.nodes.filter((node) => node.status !== 'done') ?? [];
  if (pendingNodes.length > 0) {
    lines.push(`pending_workgraph_nodes: ${String(pendingNodes.length)}`);
    for (const node of pendingNodes.slice(0, 6)) {
      lines.push(`- [${node.status}] ${node.id}: ${node.title}`);
    }
  }

  lines.push(
    'resume_policy: Continue the active Ultrawork run from this checkpoint. Do not restart UltraPlan interview, create a new plan file, or open a fresh Ultrawork run unless the checkpoint is unusable.',
  );
  return lines.join('\n');
}
