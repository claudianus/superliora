import type { Agent } from '..';
import type { CompletionAuditRejection } from '#/mission';
import type { ModeActivationSource } from '../mode-activation';
import type {
  GoalActor,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalState,
  GoalStatus,
} from './types';

/** Mutable state shared by GoalMode helper modules. */
export interface GoalModeHost {
  readonly agent: Agent;
  state: GoalState | undefined;
  activationSource: ModeActivationSource;
  completionRejectStreak: number;
  lastRejectAtTurn: number | undefined;
  lastProgressSignature: string | undefined;
  noProgressStreak: number;
  lastCompletionRejection: CompletionAuditRejection | undefined;
  clearInternal(actor: GoalActor, opts?: { emit?: boolean; track?: boolean }): void;
  applyStatus(state: GoalState, status: GoalStatus): void;
  persistState(state: GoalState | undefined, opts?: { silent?: boolean; change?: GoalChange }): void;
  appendStatusUpdate(state: GoalState, actor: GoalActor, reason?: string): void;
  toSnapshot(state: GoalState): GoalSnapshot;
  statsOf(state: GoalState): GoalChangeStats;
  emitGoalUpdated(snapshot: GoalSnapshot | null, change?: GoalChange): void;
}
