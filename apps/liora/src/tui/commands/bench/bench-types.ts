export interface BenchStatus {
  readonly sourcePath: string;
  readonly sourceDisplayPath?: string;
  readonly status: string;
  readonly score?: number;
  readonly passRate?: number;
  readonly budget?: string;
  readonly budgetExceeded?: number;
  readonly budgetTasks?: readonly BudgetTaskStatus[];
  readonly budgetInspect?: string;
  readonly budgetRerun?: string;
  readonly loopTrend?: string;
  readonly loopLatest?: string;
  readonly loopFocus?: string;
  readonly loopReason?: string;
  readonly loopAction?: string;
  readonly loopInspect?: string;
  readonly loopCost?: string;
  readonly loopGuard?: string;
  readonly loopStop?: string;
  readonly loopRerun?: string;
  readonly loopReplay?: string;
  readonly replaySummary?: string;
  readonly replayVerdict?: string;
  readonly replaySource?: string;
  readonly replayEvidence?: string;
  readonly replayInspect?: string;
  readonly replayLog?: string;
  readonly replayDiff?: string;
  readonly holdout?: string;
  readonly providerBlock?: string;
  readonly redaction?: string;
  readonly noSecret: boolean;
  readonly nextAction: string;
  readonly warnings: readonly string[];
}

export interface BudgetTaskStatus {
  readonly id: string;
  readonly violations: readonly string[];
}

export interface CandidateStatus extends BenchStatus {
  readonly timestamp: number;
}
