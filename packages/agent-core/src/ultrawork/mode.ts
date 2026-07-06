import type {
  TeamPlan,
  UltraworkRun,
  UltraworkStage,
  VerificationResult,
  WorkGraph,
} from '@superliora/protocol';

import type { Agent } from '../agent';
import type { AgentRecordOf } from '../agent/records';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph';
import { checkpointUltraworkRun } from './run-store';
import {
  UltraworkRunStateMachine,
  type UltraworkRunUpdate,
} from './state';
import type {
  CreateUltraworkRunInput,
  MarkUltraworkInterruptedInput,
  PauseUltraworkInput,
  ResumeUltraworkResult,
  UltraworkActivation,
  UltraworkPlanRecoveryContext,
} from './types';
import { buildUltraworkRecoveryReport, reconcileUltraworkRunForResume, buildUltraworkRecoveryPrompt } from './recovery';

export class UltraworkMode {
  private machine: UltraworkRunStateMachine | undefined;
  private modeEnabled = false;
  private activation: UltraworkActivation | undefined;
  private interruptReason: string | undefined;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly agent: Agent) {}

  getRun(): UltraworkRun | null {
    return this.machine?.snapshot() ?? null;
  }

  getActiveRunId(): string | undefined {
    const run = this.getRun();
    if (run === undefined || run === null) return undefined;
    if (run.status === 'done' || run.status === 'failed') return undefined;
    return run.id;
  }

  isModeEnabled(): boolean {
    return this.modeEnabled;
  }

  getActivation(): UltraworkActivation | undefined {
    return this.activation;
  }

  normalizeAfterReplay(): void {
    const run = this.getRun();
    if (run === undefined || run === null) return;
    if (run.status !== 'running') return;

    const reason = 'Paused after agent resume';
    this.interruptReason = reason;
    this.machine = new UltraworkRunStateMachine(this.machine!.markBlocked(reason));
    this.writeCheckpoint({ flush: true });
  }

  restoreRun(record: AgentRecordOf<'ultrawork.run'>): void {
    this.machine = new UltraworkRunStateMachine(record.run);
    this.activation = record.activation;
    this.interruptReason = record.interruptReason;
  }

  restoreMode(record: AgentRecordOf<'ultrawork.mode'>): void {
    this.modeEnabled = record.enabled;
  }

  create(input: CreateUltraworkRunInput): UltraworkRun {
    this.machine = UltraworkRunStateMachine.create({
      id: input.id,
      objective: input.objective,
    });
    this.activation = input.activation;
    this.interruptReason = undefined;
    this.modeEnabled = true;
    this.agent.records.logRecord({ type: 'ultrawork.mode', enabled: true });
    const run = this.advance('plan', 'Ultrawork started');
    this.writeCheckpoint({ flush: true });
    return run;
  }

  setModeEnabled(enabled: boolean): void {
    if (this.modeEnabled === enabled) return;
    this.modeEnabled = enabled;
    this.agent.records.logRecord({ type: 'ultrawork.mode', enabled });
  }

  advance(to: UltraworkStage, reason?: string): UltraworkRun {
    const machine = this.requireMachine();
    const from = machine.snapshot().stage;
    const run = machine.advance(to, reason);
    this.emitStageChanged(run, from, to, reason);
    this.scheduleCheckpoint();
    return run;
  }

  update(update: UltraworkRunUpdate): UltraworkRun {
    const machine = this.requireMachine();
    const run = machine.update(update);
    this.scheduleCheckpoint();
    return run;
  }

  syncWorkGraphFromStore(): UltraworkRun | undefined {
    const graph = this.agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined || this.machine === undefined) return undefined;
    return this.update({ workGraph: graph });
  }

  async pause(input: PauseUltraworkInput = {}): Promise<UltraworkRun | null> {
    const machine = this.machine;
    if (machine === undefined) return null;
    const run = machine.snapshot();
    if (run.status === 'done' || run.status === 'failed') return run;

    const reason = input.reason ?? 'Paused by user';
    this.interruptReason = reason;
    const blocked = machine.markBlocked(reason);
    await this.agent.goal.pauseGoal();
    this.writeCheckpoint({ flush: true });
    return blocked;
  }

  async markInterrupted(input: MarkUltraworkInterruptedInput): Promise<UltraworkRun | null> {
    const machine = this.machine;
    if (machine === undefined) return null;
    const run = machine.snapshot();
    if (run.status === 'done' || run.status === 'failed') return run;

    this.interruptReason = input.reason;
    const blocked = machine.markBlocked(input.reason);
    this.writeCheckpoint({ flush: true });
    return blocked;
  }

  async resume(): Promise<ResumeUltraworkResult | null> {
    const machine = this.machine;
    if (machine === undefined) return null;

    let run = machine.snapshot();
    if (run.status === 'done' || run.status === 'failed') return null;

    const reconciled = reconcileUltraworkRunForResume(this.agent, run);
    run = reconciled.run;
    this.machine = new UltraworkRunStateMachine(run);
    if (reconciled.workGraph !== undefined) {
      this.agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, reconciled.workGraph);
    }
    if (reconciled.teamPlan !== undefined) {
      this.machine.update({ teamPlan: reconciled.teamPlan });
      run = this.machine.snapshot();
    }

    if (run.status === 'blocked') {
      run = this.machine.resumeFromBlocked();
    }

    const savedInterruptReason = this.interruptReason;
    this.interruptReason = undefined;
    this.writeCheckpoint({ flush: true });

    let goalResumed = false;
    const goal = this.agent.goal.getGoal().goal;
    if (goal?.status === 'paused' || goal?.status === 'blocked') {
      await this.agent.goal.resumeGoal();
      goalResumed = true;
    }

    const report = buildUltraworkRecoveryReport({
      run,
      activation: this.activation,
      interruptReason: reconciled.interruptReason ?? savedInterruptReason,
      orphanedWorkNodes: reconciled.orphanedWorkNodes,
      orphanedExperts: reconciled.orphanedExperts,
      lostBackgroundTasks: reconciled.lostBackgroundTasks,
    });

    const planContext = this.capturePlanRecoveryContext();
    return {
      run,
      report,
      goalResumed,
      recoveryPrompt: buildUltraworkRecoveryPrompt(report, planContext),
    };
  }

  async cancel(reason = 'Cancelled by user'): Promise<UltraworkRun | null> {
    const machine = this.machine;
    if (machine === undefined) return null;
    const run = machine.snapshot();
    if (run.status === 'done' || run.status === 'failed') return run;

    this.interruptReason = reason;
    const failed = machine.markFailed(reason);
    await this.agent.goal.cancelGoal();
    this.modeEnabled = false;
    this.agent.records.logRecord({ type: 'ultrawork.mode', enabled: false });
    this.writeCheckpoint({ flush: true });
    return failed;
  }

  completeLearnStage(reason = 'Ultrawork completed'): UltraworkRun | null {
    const machine = this.machine;
    if (machine === undefined) return null;
    const from = machine.snapshot().stage;
    const run = machine.advance('done', reason);
    this.emitStageChanged(run, from, 'done', reason);
    this.modeEnabled = false;
    this.agent.records.logRecord({ type: 'ultrawork.mode', enabled: false });
    this.writeCheckpoint({ flush: true });
    return run;
  }

  attachTeamPlan(teamPlan: TeamPlan): UltraworkRun | null {
    if (this.machine === undefined) return null;
    return this.update({ teamPlan });
  }

  attachVerification(verification: VerificationResult): UltraworkRun | null {
    if (this.machine === undefined) return null;
    return this.update({ verification });
  }

  private requireMachine(): UltraworkRunStateMachine {
    if (this.machine === undefined) {
      throw new Error('No active Ultrawork run.');
    }
    return this.machine;
  }

  private emitStageChanged(
    run: UltraworkRun,
    from: UltraworkStage | undefined,
    to: UltraworkStage,
    reason?: string,
  ): void {
    this.agent.emitEvent({
      type: 'ultrawork.stage.changed',
      run,
      from,
      to,
      reason,
    });
  }

  private writeCheckpoint(options: { flush?: boolean } = {}): void {
    if (this.machine === undefined) return;
    const run = this.machine.snapshot();
    const planCheckpoint = this.capturePlanRecoveryContext();
    checkpointUltraworkRun(this.agent, run, {
      activation: this.activation,
      interruptReason: this.interruptReason,
      flush: options.flush,
      planCheckpoint,
    });
    if (options.flush) {
      void this.agent.records.flush();
    }
  }

  private capturePlanRecoveryContext(): UltraworkPlanRecoveryContext | undefined {
    const planMode = this.agent.planMode;
    if (!planMode.isActive || !planMode.isUltraMode) return undefined;
    return {
      planFilePath: planMode.planFilePath ?? undefined,
      phase: planMode.phase,
      interviewRoundCount: planMode.interviewRoundCount,
    };
  }

  private scheduleCheckpoint(options: { flush?: boolean } = {}): void {
    if (this.machine === undefined) return;
    if (this.checkpointTimer !== undefined) {
      clearTimeout(this.checkpointTimer);
    }
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = undefined;
      this.writeCheckpoint(options);
    }, 1000);
  }
}
