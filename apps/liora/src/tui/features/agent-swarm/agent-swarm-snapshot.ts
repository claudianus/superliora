import { COMPLETE_FILL_MS } from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import {
  terminalPhaseElapsedMs,
} from '#/tui/features/agent-swarm/agent-swarm-member-state';
import type {
  AgentSwarmMember,
  AgentSwarmPhase,
  AgentSwarmSnapshot,
} from '#/tui/features/agent-swarm/agent-swarm-progress-types';

export function buildAgentSwarmSnapshots(
  members: readonly AgentSwarmMember[],
  nowMs: number,
): AgentSwarmSnapshot[] {
  return members.map((member): AgentSwarmSnapshot => ({
    phase: member.phase,
    ticks: member.ticks,
    latestModelText: member.latestModelText,
    phaseElapsedMs: terminalPhaseElapsedMs(member, nowMs),
  }));
}

function memberPhaseSortOrder(phase: AgentSwarmPhase): number {
  if (phase === 'running') return 0;
  if (phase === 'completed') return 1;
  return 2;
}

export function sortAgentSwarmMembersForGrid(
  members: readonly AgentSwarmMember[],
): AgentSwarmMember[] {
  return [...members].toSorted(
    (left, right) => memberPhaseSortOrder(left.phase) - memberPhaseSortOrder(right.phase),
  );
}

export function hasAnimatedAgentSwarmMembers(
  members: readonly AgentSwarmMember[],
  nowMs: number,
  hasPendingCatchup: boolean,
): boolean {
  return (
    hasPendingCatchup ||
    members.some((member) =>
      (
        member.phase === 'completed' &&
        member.completedAtMs !== undefined &&
        nowMs - member.completedAtMs < COMPLETE_FILL_MS
      ) ||
      (
        member.phase === 'failed' &&
        member.failedAtMs !== undefined &&
        nowMs - member.failedAtMs < COMPLETE_FILL_MS
      ),
    )
  );
}

export function shouldRequestAgentSwarmAnimationFrame(
  lastFrameTickMs: number,
  nowMs: number,
  frameIntervalMs: number,
  hasAnimatedMembers: boolean,
): boolean {
  if (!hasAnimatedMembers) return false;
  if (lastFrameTickMs !== 0 && nowMs - lastFrameTickMs < frameIntervalMs) return false;
  return true;
}
