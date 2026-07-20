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
import { maybeSyncUltraworkStageFromWorkGraph } from './stage-progress';
import {
  applyUltraworkResumeSkipInterview,
  buildUltraworkRecoveryPrompt,
  buildUltraworkRecoveryReport,
  buildUltraworkResumeCursor,
  capturePlanRecoveryContextFromAgent,
  ensureWorkGraphForResume,
  reconcileUltraworkRunForResume,
  releaseUltraworkPlanModeIfComplete,
} from './recovery';
import type {
  CreateUltraworkRunInput,
  MarkUltraworkInterruptedInput,
  PauseUltraworkInput,
  ResumeUltraworkResult,
  UltraworkActivation,
} from './types';
import { reconcileUltraworkFromMirror } from './mirror-reconcile';
import { mirrorUltraworkWorkflowStage, seedUltraworkWorkflowReport, ensureUltraworkWorkflowArtifacts } from './workflow-report';

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

  getInterruptReason(): string | undefined {
    return this.interruptReason;
  }

  applyMirrorRunQuiet(input: {
    readonly run: UltraworkRun;
    readonly activation?: UltraworkActivation;
    readonly interruptReason?: string;
  }): void {
    if (this.machine === undefined) return;
    this.machine = new UltraworkRunStateMachine(input.run);
    if (input.activation !== undefined) {
      this.activation = input.activation;
    }
    if (input.interruptReason !== undefined) {
      this.interruptReason = input.interruptReason;
    }
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
    const existing = this.getRun();
    if (existing !== null && existing.status !== 'done' && existing.status !== 'failed') {
      throw new Error(
        `Ultrawork run ${existing.id} is already active (${existing.status} at stage ${existing.stage}). Resume or cancel it first.`,
      );
    }
    this.machine = UltraworkRunStateMachine.create({
      id: input.id,
      objective: input.objective,
    });
    this.activation = input.activation;
    this.interruptReason = undefined;
    this.modeEnabled = true;
    this.agent.records.logRecord({ type: 'ultrawork.mode', enabled: true });
    try {
      seedUltraworkWorkflowReport({
        workDir: input.activation.workDir,
        evidenceRoot: input.activation.evidenceRoot,
        runId: input.id,
        objective: input.objective,
        createdAt: this.machine.snapshot().createdAt,
        source: input.activation.source,
      });
    } catch (error) {
      this.agent.log.warn('ultrawork workflow report seed failed', { runId: input.id, error });
    }
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
    // A stage transition is a significant, infrequent milestone — flush it
    // synchronously so a crash immediately after the transition cannot lose
    // the progress marker (the debounced path would lose up to ~1s).
    this.flushCheckpoint();
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
    const updated = this.update({ workGraph: graph });
    return this.syncStageFromWorkGraph(graph) ?? updated;
  }

  syncStageFromWorkGraph(graph?: WorkGraph): UltraworkRun | undefined {
    const machine = this.machine;
    if (machine === undefined) return undefined;
    const run = machine.snapshot();
    const sourceGraph = graph ?? run.workGraph;
    if (sourceGraph === undefined || run.status !== 'running') return run;
    const from = run.stage;
    const synced = maybeSyncUltraworkStageFromWorkGraph(
      (stage, reason) => machine.syncStageForward(stage, reason),
      run,
      sourceGraph,
    );
    if (synced.stage === from) return synced;
    this.emitStageChanged(synced, from, synced.stage, 'Synced from WorkGraph progress');
    this.scheduleCheckpoint();
    return synced;
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

    await reconcileUltraworkFromMirror(this.agent);
    ensureUltraworkWorkflowArtifacts(this.agent);

    let run = machine.snapshot();
    if (run.status === 'done' || run.status === 'failed') return null;

    let planContext = capturePlanRecoveryContextFromAgent(this.agent);
    const seededGraph = await ensureWorkGraphForResume(
      this.agent,
      run,
      planContext?.planFilePath,
    );
    if (seededGraph !== undefined) {
      this.agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, seededGraph);
      run = { ...run, workGraph: seededGraph };
    }

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
    // Release plan mode before skip-interview so execution-stage resumes never
    // keep Design/Review/Write tool locks. Capture may still hold a stale
    // planContext from before release — clear it when plan mode is gone.
    releaseUltraworkPlanModeIfComplete(this.agent, run);

    const skipInterviewResult = applyUltraworkResumeSkipInterview(this.agent, run, planContext);
    run = skipInterviewResult.run;
    planContext = skipInterviewResult.planContext;
    if (!this.agent.planMode.isActive) {
      // Stale planContext would re-inject "UltraPlan phase: design" and trap
      // the model even after plan mode was correctly released.
      planContext = undefined;
    }
    this.machine = new UltraworkRunStateMachine(run);

    const savedInterruptReason = this.interruptReason;
    this.interruptReason = undefined;
    this.writeCheckpoint({ flush: true });

    let goalResumed = false;
    const goal = this.agent.goal.getGoal().goal;
    if (goal?.status === 'paused' || goal?.status === 'blocked') {
      await this.agent.goal.resumeGoal();
      goalResumed = true;
    }

    const resumeCursor = buildUltraworkResumeCursor(this.agent, run, planContext);
    const report = buildUltraworkRecoveryReport({
      run,
      activation: this.activation,
      interruptReason: reconciled.interruptReason ?? savedInterruptReason,
      orphanedWorkNodes: reconciled.orphanedWorkNodes,
      orphanedExperts: reconciled.orphanedExperts,
      lostBackgroundTasks: reconciled.lostBackgroundTasks,
      planContext,
      resumeCursor,
      skippedInterview: skipInterviewResult.skippedInterview,
    });

    return {
      run,
      report,
      goalResumed,
      recoveryPrompt: buildUltraworkRecoveryPrompt(report, planContext, resumeCursor),
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
    this.agent.telemetry.track('ultrawork_cancel', {
      run_id: run.id,
      stage: run.stage,
      reason,
      run_age_ms: Date.now() - Date.parse(run.createdAt),
    });
    this.writeCheckpoint({ flush: true });
    return failed;
  }

  completeLearnStage(reason = 'Ultrawork completed'): UltraworkRun | null {
    const machine = this.machine;
    if (machine === undefined) return null;
    const snapshot = machine.snapshot();
    if (snapshot.status === 'done' || snapshot.status === 'failed') {
      return snapshot;
    }
    let from = snapshot.stage;
    if (from !== 'learn') {
      const synced = machine.syncStageForward('learn', reason);
      if (synced.stage !== from) {
        this.emitStageChanged(synced, from, synced.stage, reason);
        this.scheduleCheckpoint();
        from = synced.stage;
      }
    }
    const run = machine.advance('done', reason);
    this.emitStageChanged(run, from, 'done', reason);
    this.modeEnabled = false;
    this.agent.records.logRecord({ type: 'ultrawork.mode', enabled: false });
    this.agent.telemetry.track('ultrawork_complete', {
      run_id: run.id,
      run_age_ms: Date.now() - Date.parse(run.createdAt),
      stage_transitions: (run.stageHistory ?? []).length,
    });
    if (this.agent.swarmMode.isActive) {
      this.agent.swarmMode.exit();
    }
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
    this.agent.telemetry.track('ultrawork_stage_change', {
      from: from ?? 'none',
      to,
      reason: reason ?? 'unknown',
      run_id: run.id,
      status: run.status,
      stage_duration_ms: stageDurationMs(run, from),
    });
    if (this.activation !== undefined && from !== to) {
      const input = {
        workDir: this.activation.workDir,
        evidenceRoot: this.activation.evidenceRoot,
        run,
        from,
        to,
        reason,
      };
      mirrorUltraworkWorkflowStage(this.agent, input);
    }
  }

  /** Flush the durable mirror immediately (e.g. before context compaction). */
  flushCheckpoint(): void {
    if (this.checkpointTimer !== undefined) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = undefined;
    }
    this.writeCheckpoint({ flush: true });
  }

  private writeCheckpoint(options: { flush?: boolean } = {}): void {
    if (this.machine === undefined) return;
    this.syncWorkGraphFromStore();
    const run = this.machine.snapshot();
    const planCheckpoint = capturePlanRecoveryContextFromAgent(this.agent);
    // Capture the durable journal append-offset so resume can use it as the
    // primary authority for mirror-vs-journal precedence (Phase 6): a mirror
    // whose offset lags the replayed journal is stale, regardless of timestamp.
    const journalOffset = this.agent.records.recordCount();
    checkpointUltraworkRun(this.agent, run, {
      activation: this.activation,
      interruptReason: this.interruptReason,
      flush: options.flush,
      planCheckpoint,
      journalOffset,
    });
    if (options.flush) {
      void this.agent.records.flush();
    }
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

/** Calculate milliseconds spent in the `from` stage based on stageHistory. */
function stageDurationMs(run: UltraworkRun, from: UltraworkStage | undefined): number | undefined {
  if (from === undefined) return undefined;
  const history = run.stageHistory ?? [];
  // Find the last entry for the `from` stage
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry !== undefined && entry.stage === from) {
      const entered = Date.parse(entry.enteredAt);
      if (Number.isFinite(entered)) return Date.now() - entered;
      return undefined;
    }
  }
  return undefined;
}
