import type { UltraworkRun, UltraworkStage } from '@superliora/protocol';

export type UltraworkActivationSource = 'manual' | 'auto' | 'shift-tab' | 'goal' | 'headless';

export interface UltraworkActivation {
  readonly source: UltraworkActivationSource;
  readonly replaceGoal: boolean;
  readonly evidenceRoot: string;
  readonly workDir: string;
}

export interface CreateUltraworkRunInput {
  readonly id: string;
  readonly objective: string;
  readonly activation: UltraworkActivation;
}

export interface UltraworkRunMirror {
  /**
   * Mirror schema version. Bumped when the on-disk shape changes in a way old
   * readers cannot safely consume. Readers accept their own version and
   * earlier; `readUltraworkMirrorFromDisk` validates this.
   */
  readonly schema: 2;
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly planCheckpoint?: UltraworkPlanRecoveryContext;
  readonly goalStatus?: string;
  readonly resumeCursor?: UltraworkResumeCursor;
  readonly effectiveStage?: UltraworkStage;
  readonly compactionBoundary?: boolean;
  readonly lastCheckpointAt: string;
  /**
   * The wire-log append offset (total fsync'd record count) at the time this
   * checkpoint was written. Resume uses it as the primary authority for
   * mirror-vs-journal precedence: a mirror whose offset is behind the
   * replayed journal is stale and ignored, even if its timestamp is newer.
   */
  readonly journalOffset?: number;
}

export interface UltraworkPlanRecoveryContext {
  readonly planFilePath?: string;
  readonly phase?: string;
  readonly interviewRoundCount?: number;
  readonly ultraPlan?: Record<string, unknown>;
}

export interface UltraworkResumeCursor {
  readonly stage: UltraworkStage;
  readonly planPhase?: string;
  readonly interviewRound?: number;
  readonly workGraphNodeId?: string;
  readonly goalStatus?: string;
  /**
   * Wire-log offset captured at the checkpoint, surfaced to the recovery
   * prompt so the resume cursor records exactly how far the journal had
   * progressed when the run was last durable.
   */
  readonly journalOffset?: number;
}

export interface UltraworkRecoveryReport {
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
  readonly nextActions: readonly string[];
  readonly skippedInterview?: boolean;
}

export interface MarkUltraworkInterruptedInput {
  readonly reason: string;
  readonly stage?: UltraworkStage;
}

export interface PauseUltraworkInput {
  readonly reason?: string;
}

export interface ResumeUltraworkResult {
  readonly run: UltraworkRun;
  readonly report: UltraworkRecoveryReport;
  readonly goalResumed: boolean;
  readonly recoveryPrompt: string;
}
