import type { TelemetryProperties } from '../../telemetry';
import { budgetTelemetryProperties, liveWallClockMs } from './budget';
import type { GoalModeHost } from './goal-mode-host';
import { toGoalSnapshot } from './goal-snapshot';
import type { AgentRecordOf } from '../records/types';
import type { GoalActor, GoalChange, GoalSnapshot, GoalState } from './types';

export function clearGoalInternal(
  host: GoalModeHost,
  actor: GoalActor,
  opts: { emit?: boolean; track?: boolean } = {},
): void {
  const state = host.state;
  if (state === undefined) return; // idempotent
  persistGoalState(host, undefined, { silent: opts.emit === false });
  host.agent.records.logRecord({ type: 'goal.clear' });
  if (opts.track !== false) {
    trackGoalEvent(host, 'goal_cleared', { actor });
  }
}

export function appendGoalStatusUpdate(
  host: GoalModeHost,
  state: GoalState,
  actor: GoalActor,
  reason?: string,
): void {
  appendGoalRecordUpdate(host, {
    status: state.status,
    reason,
    wallClockMs: liveWallClockMs(state, Date.now()),
    actor,
  });
  trackGoalEvent(host, 'goal_status_changed', {
    actor,
    status: state.status,
    turns_used: state.turnsUsed,
    tokens_used: state.tokensUsed,
    wall_clock_ms: liveWallClockMs(state, Date.now()),
    ...budgetTelemetryProperties(state.budgetLimits),
  });
}

export function appendGoalRecordUpdate(
  host: GoalModeHost,
  update: Omit<AgentRecordOf<'goal.update'>, 'type' | 'time'>,
): void {
  host.agent.records.logRecord({
    type: 'goal.update',
    ...update,
  });
}

export function trackGoalCreated(host: GoalModeHost, actor: GoalActor, replace: boolean): void {
  trackGoalEvent(host, 'goal_created', {
    actor,
    replace,
  });
}

export function trackGoalEvent(
  host: GoalModeHost,
  event: string,
  properties: TelemetryProperties,
): void {
  host.agent.telemetry.track(event, properties);
}

export function persistGoalState(
  host: GoalModeHost,
  state: GoalState | undefined,
  opts: { silent?: boolean; change?: GoalChange } = {},
): void {
  host.state = state;
  if (opts.silent !== true) {
    emitGoalUpdatedEvent(
      host,
      state === undefined ? null : toGoalSnapshot(state),
      opts.change,
    );
  }
}

export function emitGoalUpdatedEvent(
  host: GoalModeHost,
  snapshot: GoalSnapshot | null,
  change?: GoalChange,
): void {
  host.agent.emitEvent({ type: 'goal.updated', snapshot, change });
}
