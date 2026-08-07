/**
 * Goal RPC delegation for Session — extracted from session.ts.
 */

import { SessionBackgroundTasksMixin } from '#/session/session-background-tasks';
import type { CreateGoalInput, GoalSnapshot, GoalToolResult } from '#/session/types';

export abstract class SessionGoalsMixin extends SessionBackgroundTasksMixin {
  // --- Goal lifecycle ---------------------------------------------------
  // Deterministic user/host control surface. There is intentionally no
  // `updateGoal`: the goal's terminal status is decided by the model via the
  // in-conversation UpdateGoal tool (or the goal driver on budget/error), not
  // by the host.

  async createGoal(input: CreateGoalInput): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.createGoal({ sessionId: this.id, ...input });
  }

  async getGoal(): Promise<GoalToolResult> {
    this.ensureOpen();
    return this.rpc.getGoal({ sessionId: this.id });
  }

  async pauseGoal(): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.pauseGoal({ sessionId: this.id });
  }

  async resumeGoal(): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.resumeGoal({ sessionId: this.id });
  }

  async cancelGoal(): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.cancelGoal({ sessionId: this.id });
  }
}
