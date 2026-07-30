import type { Event, TeamPlan } from '@superliora/sdk';
import type { Component } from '#/tui/renderer';

import type { UltraSwarmMemberMetadata } from '../../components/messages/agent-swarm-progress';

export type SubagentLifecycleEvent = Event & { type: `subagent.${string}` };
export type SubagentLifecycleEventOf<Type extends SubagentLifecycleEvent['type']> =
  SubagentLifecycleEvent & { type: Type };

export function isSubagentLifecycleEvent(event: Event): event is SubagentLifecycleEvent {
  return (
    event.type === 'subagent.spawned' ||
    event.type === 'subagent.started' ||
    event.type === 'subagent.suspended' ||
    event.type === 'subagent.completed' ||
    event.type === 'subagent.failed'
  );
}

/**
 * Retry / fallback hints are not part of the protocol schema yet, so read
 * them defensively. When a server starts emitting them the swarm failure
 * cell shows a dim note such as ` · retrying (2/3)` or ` · fell back to …`.
 */
export function subagentFailureRetryNote(
  event: SubagentLifecycleEventOf<'subagent.failed'>,
): string | undefined {
  const extras = event as unknown as Record<string, unknown>;
  const parts: string[] = [];
  const retryAttempt = extras['retryAttempt'];
  if (typeof retryAttempt === 'number' && Number.isFinite(retryAttempt) && retryAttempt > 0) {
    const retryLimit = extras['retryLimit'];
    parts.push(
      typeof retryLimit === 'number' && Number.isFinite(retryLimit) && retryLimit > 0
        ? `retrying (${String(retryAttempt)}/${String(retryLimit)})`
        : `retrying (attempt ${String(retryAttempt)})`,
    );
  }
  const fellBackToModel = extras['fellBackToModel'];
  if (typeof fellBackToModel === 'string' && fellBackToModel.trim().length > 0) {
    parts.push(`fell back to ${fellBackToModel.trim()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function ultraSwarmMembersFromTeam(team: TeamPlan): UltraSwarmMemberMetadata[] {
  return team.experts.map((expert) => ({
    expertId: expert.id,
    name: expert.name,
    division: expert.division,
    emoji: expert.emoji,
    coverageLane: expert.coverageLane ?? expert.role,
    selectionReason: expert.selectionReason,
    focus: expert.focus,
    dependsOn: expert.dependsOn,
    taskIds: expert.taskIds,
  }));
}

export function isUserCancelledSubagentError(error: string): boolean {
  // Structured AgentSwarm results use outcome="aborted" and are parsed separately.
  switch (error.trim()) {
    case 'Aborted by the user':
    case 'The user manually interrupted this subagent batch.':
      return true;
    default:
      return false;
  }
}

export function renderedRowsAfterChild(
  children: readonly Component[],
  child: Component,
  width: number,
): number {
  const childIndex = children.indexOf(child);
  if (childIndex < 0) return 0;
  return children
    .slice(childIndex + 1)
    .reduce((sum, component) => sum + component.render(width).length, 0);
}
