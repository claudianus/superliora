import type {
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
} from '#/agent/goal';

// Goal lifecycle payloads and re-exported goal value types. These describe the
// deterministic user/SDK control surface; the goal's terminal status is decided
// by the model via the UpdateGoal tool (or the goal driver on budget/error),
// not set through this API.
export type {
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
};

export interface CreateUltraworkRunPayload {
  readonly id: string;
  readonly objective: string;
  readonly source: 'manual' | 'auto' | 'shift-tab' | 'goal' | 'headless';
  readonly replaceGoal: boolean;
  readonly evidenceRoot: string;
  readonly workDir: string;
}

export interface PauseUltraworkPayload {
  readonly reason?: string;
}

/** War-room / /swarm restaff: force adaptive restaff without pausing. */
export interface SwarmRestaffPayload {
  readonly reason?: string;
}

export interface CancelUltraworkPayload {
  readonly reason?: string;
}

export interface ClassifyUltraworkAutoActivationPayload {
  readonly text: string;
}

export interface UltraworkAutoActivationDecision {
  readonly activate: boolean;
  readonly confidence: number;
  readonly reason: string;
}
export interface ClassifyUltraworkObjectiveProfilePayload {
  readonly text: string;
}

export interface UltraworkObjectiveProfileDecision {
  readonly visualSurface: boolean;
  readonly benchSurface: boolean;
  readonly premiumDensity: 'visual' | 'code';
  readonly lanes: readonly string[];
  readonly confidence: number;
  readonly reason: string;
  readonly source: 'llm' | 'fallback';
}

export type UltraworkRunSnapshot = import('@superliora/protocol').UltraworkRun;

export interface ResumeUltraworkPayloadResult {
  readonly run: UltraworkRunSnapshot;
  readonly report: import('../../ultrawork').UltraworkRecoveryReport;
  readonly goalResumed: boolean;
  readonly recoveryPrompt: string;
}
