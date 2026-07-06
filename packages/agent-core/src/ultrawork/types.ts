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
  readonly schema: 1;
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly planCheckpoint?: UltraworkPlanRecoveryContext;
  readonly lastCheckpointAt: string;
}

export interface UltraworkPlanRecoveryContext {
  readonly planFilePath?: string;
  readonly phase?: string;
  readonly interviewRoundCount?: number;
}

export interface UltraworkRecoveryReport {
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
  readonly nextActions: readonly string[];
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
