/**
 * Goal and Ultrawork RPC delegation for Session — extracted from session.ts.
 */

import {
  tryAutoResumeUltrawork,
  type AutoResumeUltraworkResult,
} from '#/ultrawork-auto-resume';
import { SessionBackgroundTasksMixin } from '#/session-background-tasks';
import type {
  CancelUltraworkInput,
  CreateGoalInput,
  CreateUltraworkRunInput,
  GoalSnapshot,
  GoalToolResult,
  PauseUltraworkInput,
  ResumeUltraworkPayloadResult,
  SwarmRestaffInput,
  UltraworkAutoActivationDecision,
  UltraworkObjectiveProfileDecision,
  UltraworkRun,
} from '#/types';

export abstract class SessionGoalsUltraworkMixin extends SessionBackgroundTasksMixin {
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

  async createUltraworkRun(input: CreateUltraworkRunInput): Promise<UltraworkRun> {
    this.ensureOpen();
    return this.rpc.createUltraworkRun({ sessionId: this.id, ...input });
  }

  async getUltraworkRun(): Promise<UltraworkRun | null> {
    this.ensureOpen();
    return this.rpc.getUltraworkRun({ sessionId: this.id });
  }

  async pauseUltrawork(input: PauseUltraworkInput = {}): Promise<UltraworkRun | null> {
    this.ensureOpen();
    return this.rpc.pauseUltrawork({ sessionId: this.id, ...input });
  }

  /**
   * Force an UltraSwarm adaptive restaff wave without pausing the run.
   * Returns false when no UltraSwarm run is active.
   */
  async swarmRestaff(input: SwarmRestaffInput = {}): Promise<boolean> {
    this.ensureOpen();
    return this.rpc.swarmRestaff({ sessionId: this.id, ...input });
  }

  async resumeUltrawork(): Promise<ResumeUltraworkPayloadResult | null> {
    this.ensureOpen();
    return this.rpc.resumeUltrawork({ sessionId: this.id });
  }

  async tryAutoResumeUltrawork(): Promise<AutoResumeUltraworkResult | null> {
    this.ensureOpen();
    return tryAutoResumeUltrawork(this);
  }

  async cancelUltrawork(input: CancelUltraworkInput = {}): Promise<UltraworkRun | null> {
    this.ensureOpen();
    return this.rpc.cancelUltrawork({ sessionId: this.id, ...input });
  }

  /**
   * @deprecated The TUI no longer routes prompts through a pre-agent
   * classifier; natural language goes straight to the main agent, which
   * decides itself whether to use Ultrawork/UltraSwarm tooling. Kept for
   * SDK compatibility and slated for removal.
   */
  async classifyUltraworkAutoActivation(
    text: string,
  ): Promise<UltraworkAutoActivationDecision> {
    this.ensureOpen();
    return this.rpc.classifyUltraworkAutoActivation({ sessionId: this.id, text });
  }

  async classifyUltraworkObjectiveProfile(
    text: string,
  ): Promise<UltraworkObjectiveProfileDecision> {
    this.ensureOpen();
    return this.rpc.classifyUltraworkObjectiveProfile({ sessionId: this.id, text });
  }
}
