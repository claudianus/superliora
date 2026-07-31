// Health, backpressure, and budget signals for Ultrawork runs.
/**
 * Context pressure levels. Based on context engineering best practices (2026):
 * "context rot" — as tokens increase, model recall accuracy decreases.
 */
export type ContextPressureLevel = 'low' | 'moderate' | 'high' | 'critical';

/**
 * Context pressure thresholds (ratio of used context to max context).
 * Aligned with compaction trigger ratios in the compaction strategy.
 */
const CONTEXT_PRESSURE_THRESHOLDS: Readonly<Record<ContextPressureLevel, number>> = {
  low: 0.5, // Below 50% — plenty of room
  moderate: 0.7, // 50-70% — normal operating range
  high: 0.85, // 70-85% — approaching compaction trigger
  critical: 1.0, // Above 85% — compaction imminent or overdue
};

/**
 * Guidance per context pressure level. Helps the agent understand
 * when to be more conservative with context usage.
 */
export const CONTEXT_PRESSURE_GUIDANCE: Readonly<Record<ContextPressureLevel, string>> = {
  low: 'Context budget healthy; full tool output and detailed reasoning available.',
  moderate: 'Context usage moderate; prefer concise tool outputs and focused reasoning.',
  high: 'Context pressure high; truncate tool outputs, avoid verbose logging, consider compaction.',
  critical: 'Context critical; minimize all non-essential output, compaction likely needed immediately.',
};

/**
 * Assess context pressure level based on usage ratio.
 * Returns the pressure level and corresponding guidance.
 */
export function assessContextPressure(usageRatio: number): {
  readonly level: ContextPressureLevel;
  readonly guidance: string;
} {
  if (usageRatio < CONTEXT_PRESSURE_THRESHOLDS.low) {
    return { level: 'low', guidance: CONTEXT_PRESSURE_GUIDANCE.low };
  }
  if (usageRatio < CONTEXT_PRESSURE_THRESHOLDS.moderate) {
    return { level: 'moderate', guidance: CONTEXT_PRESSURE_GUIDANCE.moderate };
  }
  if (usageRatio < CONTEXT_PRESSURE_THRESHOLDS.high) {
    return { level: 'high', guidance: CONTEXT_PRESSURE_GUIDANCE.high };
  }
  return { level: 'critical', guidance: CONTEXT_PRESSURE_GUIDANCE.critical };
}

// ---------------------------------------------------------------------------
// Graduated recovery escalation (self-healing pattern)
// ---------------------------------------------------------------------------

export type RecoveryEscalationLevel = 'retry' | 'replan' | 'degrade' | 'abort';

const ESCALATION_THRESHOLDS: Readonly<Record<RecoveryEscalationLevel, number>> = {
  retry: 0, // First failure: simple retry
  replan: 2, // After 2 failures: re-plan approach
  degrade: 4, // After 4 failures: degrade scope
  abort: 6, // After 6 failures: consider aborting
};

export const ESCALATION_GUIDANCE: Readonly<Record<RecoveryEscalationLevel, string>> = {
  retry: 'Retry the failed operation with the same approach; transient errors often resolve on retry.',
  replan: 'Multiple failures detected; re-plan the approach — try a different strategy or break into smaller steps.',
  degrade: 'Persistent failures; consider degrading scope — skip non-critical subtasks or use fallback implementations.',
  abort: 'Repeated failures across multiple attempts; consider aborting this path and reporting to user for guidance.',
};

/**
 * Determine the appropriate recovery escalation level based on failure count.
 * Follows the "graduated remediation" pattern: start with low-risk actions,
 * escalate to more significant interventions as failures accumulate.
 */
export function assessRecoveryEscalation(failureCount: number): {
  readonly level: RecoveryEscalationLevel;
  readonly guidance: string;
} {
  if (failureCount >= ESCALATION_THRESHOLDS.abort) {
    return { level: 'abort', guidance: ESCALATION_GUIDANCE.abort };
  }
  if (failureCount >= ESCALATION_THRESHOLDS.degrade) {
    return { level: 'degrade', guidance: ESCALATION_GUIDANCE.degrade };
  }
  if (failureCount >= ESCALATION_THRESHOLDS.replan) {
    return { level: 'replan', guidance: ESCALATION_GUIDANCE.replan };
  }
  return { level: 'retry', guidance: ESCALATION_GUIDANCE.retry };
}

// ---------------------------------------------------------------------------
// Run health score (aggregate observability signal)
// ---------------------------------------------------------------------------

export interface RunHealthSignals {
  readonly failureCount: number;
  readonly resumeCycles: number;
  readonly stuckNodeCount: number;
  readonly longRunningStage: boolean;
  readonly contextPressureRatio: number;
}

export type RunHealthGrade = 'healthy' | 'degraded' | 'critical';

/**
 * Compute an aggregate health score for an Ultrawork run.
 * Combines multiple signals into a single grade for quick assessment.
 * Score ranges from 0 (critical) to 100 (healthy).
 */
export function computeRunHealthScore(signals: RunHealthSignals): {
  readonly score: number;
  readonly grade: RunHealthGrade;
  readonly factors: readonly string[];
} {
  let score = 100;
  const factors: string[] = [];

  // Deduct for failures (max -30)
  if (signals.failureCount > 0) {
    const penalty = Math.min(30, signals.failureCount * 5);
    score -= penalty;
    factors.push(`failures: -${String(penalty)}`);
  }

  // Deduct for resume cycles (max -25)
  if (signals.resumeCycles > 0) {
    const penalty = Math.min(25, signals.resumeCycles * 8);
    score -= penalty;
    factors.push(`resumes: -${String(penalty)}`);
  }

  // Deduct for stuck nodes (max -20)
  if (signals.stuckNodeCount > 0) {
    const penalty = Math.min(20, signals.stuckNodeCount * 10);
    score -= penalty;
    factors.push(`stuck_nodes: -${String(penalty)}`);
  }

  // Deduct for long-running stage (-15)
  if (signals.longRunningStage) {
    score -= 15;
    factors.push('long_stage: -15');
  }

  // Deduct for context pressure (max -20)
  if (signals.contextPressureRatio > 0.7) {
    const penalty = Math.min(20, Math.round((signals.contextPressureRatio - 0.7) * 66));
    score -= penalty;
    factors.push(`context_pressure: -${String(penalty)}`);
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  const grade: RunHealthGrade =
    clampedScore >= 70 ? 'healthy' : clampedScore >= 40 ? 'degraded' : 'critical';

  return { score: clampedScore, grade, factors };
}

// ---------------------------------------------------------------------------
// Backpressure signal (adaptive throttling)
// ---------------------------------------------------------------------------

export type BackpressureLevel = 'none' | 'light' | 'moderate' | 'heavy';

export interface BackpressureInputs {
  readonly contextPressureRatio: number;
  readonly circuitBreakerOpen: boolean;
  readonly runHealthGrade: RunHealthGrade;
  readonly pendingToolCalls: number;
}

export const BACKPRESSURE_GUIDANCE: Readonly<Record<BackpressureLevel, string>> = {
  none: 'System operating normally; proceed at full speed.',
  light: 'Minor pressure detected; consider batching operations or reducing verbosity.',
  moderate: 'Significant pressure; slow down — defer non-critical work, reduce parallel operations.',
  heavy: 'System under heavy pressure; pause non-essential operations, wait for recovery before continuing.',
};

/**
 * Compute a unified backpressure signal from multiple system health indicators.
 * Follows the "backpressure signaling" pattern: tell upstream to slow down
 * before rejection becomes necessary.
 */
export function assessBackpressure(inputs: BackpressureInputs): {
  readonly level: BackpressureLevel;
  readonly guidance: string;
} {
  let pressure = 0;

  // Context pressure contributes 0-3 points
  if (inputs.contextPressureRatio >= 0.85) pressure += 3;
  else if (inputs.contextPressureRatio >= 0.7) pressure += 2;
  else if (inputs.contextPressureRatio >= 0.5) pressure += 1;

  // Circuit breaker open contributes 2 points
  if (inputs.circuitBreakerOpen) pressure += 2;

  // Run health grade contributes 0-3 points
  if (inputs.runHealthGrade === 'critical') pressure += 3;
  else if (inputs.runHealthGrade === 'degraded') pressure += 1;

  // Pending tool calls contribute 0-2 points (queue depth)
  if (inputs.pendingToolCalls >= 10) pressure += 2;
  else if (inputs.pendingToolCalls >= 5) pressure += 1;

  const level: BackpressureLevel =
    pressure >= 6 ? 'heavy' : pressure >= 4 ? 'moderate' : pressure >= 2 ? 'light' : 'none';

  return { level, guidance: BACKPRESSURE_GUIDANCE[level] };
}

// ---------------------------------------------------------------------------
// Degradation mode tracking (graceful degradation pattern)
// ---------------------------------------------------------------------------

export type DegradationLevel = 'normal' | 'degraded' | 'severe' | 'critical';

export interface DegradationState {
  readonly level: DegradationLevel;
  readonly affectedCapabilities: readonly string[];
  readonly activeSince: number;
  readonly reason: string;
}

export const DEGRADATION_GUIDANCE: Readonly<Record<DegradationLevel, string>> = {
  normal: 'All systems operational; full capabilities available.',
  degraded: 'Minor degradation; some features may be slower or limited. Continue with caution.',
  severe: 'Significant degradation; non-essential features disabled. Focus on core task completion.',
  critical: 'Critical degradation; only essential operations available. Consider pausing or aborting.',
};

/**
 * Assess the current degradation level based on system health signals.
 * Follows the "graceful degradation" pattern: maintain core functionality
 * even under severely degraded conditions.
 */
export function assessDegradationLevel(inputs: {
  readonly backpressureLevel: BackpressureLevel;
  readonly circuitBreakersOpen: number;
  readonly runHealthScore: number;
}): {
  readonly level: DegradationLevel;
  readonly guidance: string;
  readonly affectedCapabilities: readonly string[];
} {
  const { backpressureLevel, circuitBreakersOpen, runHealthScore } = inputs;
  const affected: string[] = [];

  // Calculate degradation score
  let score = 0;
  if (backpressureLevel === 'heavy') score += 3;
  else if (backpressureLevel === 'moderate') score += 2;
  else if (backpressureLevel === 'light') score += 1;

  score += Math.min(3, circuitBreakersOpen);

  if (runHealthScore < 40) score += 3;
  else if (runHealthScore < 70) score += 1;

  // Determine level and affected capabilities
  let level: DegradationLevel;
  if (score >= 7) {
    level = 'critical';
    affected.push('parallel_execution', 'non_essential_tools', 'verbose_logging');
  } else if (score >= 5) {
    level = 'severe';
    affected.push('parallel_execution', 'optional_verification');
  } else if (score >= 3) {
    level = 'degraded';
    affected.push('concurrent_operations');
  } else {
    level = 'normal';
  }

  return { level, guidance: DEGRADATION_GUIDANCE[level], affectedCapabilities: affected };
}

// ---------------------------------------------------------------------------
// Turn budget tracking (runaway loop prevention)
// ---------------------------------------------------------------------------

export type BudgetStatus = 'ok' | 'warning' | 'critical' | 'exhausted';

/**
 * Default turn budget for an Ultrawork run. Based on the "Loop Problem":
 * agents can make 200+ LLM calls in 10 minutes when stuck. A workflow-level
 * budget acts as a circuit breaker that infrastructure monitors cannot see.
 */
const DEFAULT_TURN_BUDGET = 100;

/** Soft limit threshold (percentage of budget). */
const BUDGET_SOFT_LIMIT_RATIO = 0.8;

/** Critical threshold (percentage of budget). */
const BUDGET_CRITICAL_RATIO = 0.95;

export const BUDGET_GUIDANCE: Readonly<Record<BudgetStatus, string>> = {
  ok: 'Turn budget healthy; continue normal operations.',
  warning: 'Approaching turn budget; prioritize essential work, avoid exploratory detours.',
  critical: 'Turn budget nearly exhausted; wrap up current step, prepare summary of progress.',
  exhausted: 'Turn budget exhausted; stop work and report status to user.',
};

/**
 * Assess turn budget status for an Ultrawork run.
 * Follows the "soft limit warnings, hard limit enforcement" pattern.
 */
export function assessTurnBudget(usedTurns: number, budget: number = DEFAULT_TURN_BUDGET): {
  readonly status: BudgetStatus;
  readonly guidance: string;
  readonly usedTurns: number;
  readonly remainingTurns: number;
  readonly usageRatio: number;
} {
  const usageRatio = budget > 0 ? usedTurns / budget : 1;
  const remainingTurns = Math.max(0, budget - usedTurns);

  let status: BudgetStatus;
  if (usedTurns >= budget) {
    status = 'exhausted';
  } else if (usageRatio >= BUDGET_CRITICAL_RATIO) {
    status = 'critical';
  } else if (usageRatio >= BUDGET_SOFT_LIMIT_RATIO) {
    status = 'warning';
  } else {
    status = 'ok';
  }

  return {
    status,
    guidance: BUDGET_GUIDANCE[status],
    usedTurns,
    remainingTurns,
    usageRatio,
  };
}
