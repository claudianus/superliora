export type RendererQualityLevel = 'full' | 'high' | 'balanced' | 'minimal';
export type RendererQualityChangeReason =
  | 'over-budget'
  | 'predicted-overbudget'
  | 'output-backpressure'
  | 'output-pressure'
  | 'recovered';

export interface RendererQualityMetrics {
  readonly durationMs: number;
  readonly targetFrameMs: number;
  readonly overBudget: boolean;
  readonly outputBackpressure?: boolean;
  readonly outputBytes?: number;
  readonly changedCells?: number;
  readonly totalCells?: number;
}

export interface RendererQualityControllerOptions {
  readonly initialLevel?: RendererQualityLevel;
  readonly degradeAfterFrames?: number;
  readonly degradeAfterBackpressureFrames?: number;
  readonly degradeAfterOutputPressureFrames?: number;
  readonly outputPressureBytes?: number;
  readonly outputPressureCellRatio?: number;
  readonly recoverAfterFrames?: number;
  readonly recoverBelowFrameBudgetRatio?: number;
}

export interface RendererQualitySnapshot {
  readonly level: RendererQualityLevel;
  readonly consecutiveOverBudgetFrames: number;
  readonly consecutiveOutputPressureFrames: number;
  readonly consecutiveUnderBudgetFrames: number;
  readonly changes: number;
  readonly lastChangeReason?: RendererQualityChangeReason;
}

const QUALITY_LEVELS: readonly RendererQualityLevel[] = ['minimal', 'balanced', 'high', 'full'];
const DEFAULT_DEGRADE_AFTER_FRAMES = 2;
const DEFAULT_DEGRADE_AFTER_BACKPRESSURE_FRAMES = 1;
const DEFAULT_DEGRADE_AFTER_OUTPUT_PRESSURE_FRAMES = 2;
const DEFAULT_OUTPUT_PRESSURE_BYTES = 64 * 1024;
const DEFAULT_OUTPUT_PRESSURE_CELL_RATIO = 0.85;
const DEFAULT_RECOVER_AFTER_FRAMES = 90;
const DEFAULT_RECOVER_BELOW_FRAME_BUDGET_RATIO = 0.65;
/** EMA smoothing factor — higher = more weight on recent frames. */
const EMA_ALPHA = 0.3;
/** Predictive degradation triggers when EMA exceeds this ratio of budget. */
const PREDICTIVE_PRESSURE_RATIO = 0.85;
/** Consecutive predictive pressure frames before degradation. */
const PREDICTIVE_PRESSURE_FRAMES = 3;
/** Fast recovery: EMA below this ratio of budget allows shorter recovery. */
const FAST_RECOVER_RATIO = 0.5;
/** Fast recovery frame count (vs default 90). */
const FAST_RECOVER_AFTER_FRAMES = 30;

export class RendererQualityController {
  private level: RendererQualityLevel;
  private readonly degradeAfterFrames: number;
  private readonly degradeAfterBackpressureFrames: number;
  private readonly degradeAfterOutputPressureFrames: number;
  private readonly outputPressureBytes: number;
  private readonly outputPressureCellRatio: number;
  private readonly recoverAfterFrames: number;
  private readonly recoverBelowFrameBudgetRatio: number;
  private consecutiveOverBudgetFrames = 0;
  private consecutiveBackpressureFrames = 0;
  private consecutiveOutputPressureFrames = 0;
  private consecutiveUnderBudgetFrames = 0;
  private changes = 0;
  private lastChangeReason: RendererQualityChangeReason | undefined;
  /** EMA of frame cost for predictive quality adjustment. */
  private emaFrameCostMs = 0;
  private emaInitialized = false;
  private predictivePressureFrames = 0;

  constructor(options: RendererQualityControllerOptions = {}) {
    this.level = options.initialLevel ?? 'full';
    this.degradeAfterFrames = normalizePositiveInteger(
      options.degradeAfterFrames,
      DEFAULT_DEGRADE_AFTER_FRAMES,
    );
    this.degradeAfterBackpressureFrames = normalizePositiveInteger(
      options.degradeAfterBackpressureFrames,
      DEFAULT_DEGRADE_AFTER_BACKPRESSURE_FRAMES,
    );
    this.degradeAfterOutputPressureFrames = normalizePositiveInteger(
      options.degradeAfterOutputPressureFrames,
      DEFAULT_DEGRADE_AFTER_OUTPUT_PRESSURE_FRAMES,
    );
    this.outputPressureBytes = normalizePositiveInteger(
      options.outputPressureBytes,
      DEFAULT_OUTPUT_PRESSURE_BYTES,
    );
    this.outputPressureCellRatio = normalizeRatio(
      options.outputPressureCellRatio,
      DEFAULT_OUTPUT_PRESSURE_CELL_RATIO,
    );
    this.recoverAfterFrames = normalizePositiveInteger(
      options.recoverAfterFrames,
      DEFAULT_RECOVER_AFTER_FRAMES,
    );
    this.recoverBelowFrameBudgetRatio = normalizeRatio(
      options.recoverBelowFrameBudgetRatio,
      DEFAULT_RECOVER_BELOW_FRAME_BUDGET_RATIO,
    );
  }

  get currentLevel(): RendererQualityLevel {
    return this.level;
  }

  snapshot(): RendererQualitySnapshot {
    return {
      level: this.level,
      consecutiveOverBudgetFrames: this.consecutiveOverBudgetFrames,
      consecutiveOutputPressureFrames: this.consecutiveOutputPressureFrames,
      consecutiveUnderBudgetFrames: this.consecutiveUnderBudgetFrames,
      changes: this.changes,
      lastChangeReason: this.lastChangeReason,
    };
  }

  record(metrics: RendererQualityMetrics): RendererQualitySnapshot {
    // Update EMA frame cost predictor.
    this.updateEma(metrics);

    if (metrics.outputBackpressure === true) {
      this.consecutiveBackpressureFrames++;
      this.consecutiveOverBudgetFrames = 0;
      this.consecutiveOutputPressureFrames = 0;
      this.consecutiveUnderBudgetFrames = 0;
      this.predictivePressureFrames = 0;
      if (this.consecutiveBackpressureFrames >= this.degradeAfterBackpressureFrames) {
        this.setLevel(stepQualityLevel(this.level, -1), 'output-backpressure');
      }
      return this.snapshot();
    }

    this.consecutiveBackpressureFrames = 0;
    if (isOverBudget(metrics)) {
      this.consecutiveOverBudgetFrames++;
      this.consecutiveOutputPressureFrames = 0;
      this.consecutiveUnderBudgetFrames = 0;
      this.predictivePressureFrames = 0;
      if (this.consecutiveOverBudgetFrames >= this.degradeAfterFrames) {
        this.setLevel(stepQualityLevel(this.level, -1), 'over-budget');
      }
      return this.snapshot();
    }

    this.consecutiveOverBudgetFrames = 0;

    // Predictive degradation: EMA approaching budget → preemptive downgrade
    // before actual jank occurs.
    if (this.isPredictivePressure(metrics)) {
      this.predictivePressureFrames++;
      this.consecutiveUnderBudgetFrames = 0;
      if (this.predictivePressureFrames >= PREDICTIVE_PRESSURE_FRAMES) {
        this.setLevel(stepQualityLevel(this.level, -1), 'predicted-overbudget');
      }
      return this.snapshot();
    }
    this.predictivePressureFrames = 0;

    if (isOutputPressure(metrics, this.outputPressureBytes, this.outputPressureCellRatio)) {
      this.consecutiveOutputPressureFrames++;
      this.consecutiveUnderBudgetFrames = 0;
      if (this.consecutiveOutputPressureFrames >= this.degradeAfterOutputPressureFrames) {
        this.setLevel(stepQualityLevel(this.level, -1), 'output-pressure');
      }
      return this.snapshot();
    }

    this.consecutiveOutputPressureFrames = 0;
    if (isSafelyUnderBudget(metrics, this.recoverBelowFrameBudgetRatio)) {
      this.consecutiveUnderBudgetFrames++;
      // Fast recovery: when EMA is well under budget, recover sooner.
      const recoveryThreshold = this.isEmaWellUnderBudget(metrics)
        ? Math.min(this.recoverAfterFrames, FAST_RECOVER_AFTER_FRAMES)
        : this.recoverAfterFrames;
      if (this.consecutiveUnderBudgetFrames >= recoveryThreshold) {
        this.setLevel(stepQualityLevel(this.level, 1), 'recovered');
      }
    } else {
      this.consecutiveUnderBudgetFrames = 0;
    }

    return this.snapshot();
  }

  reset(level: RendererQualityLevel = 'full'): void {
    this.level = level;
    this.consecutiveOverBudgetFrames = 0;
    this.consecutiveBackpressureFrames = 0;
    this.consecutiveOutputPressureFrames = 0;
    this.consecutiveUnderBudgetFrames = 0;
    this.changes = 0;
    this.lastChangeReason = undefined;
    this.emaFrameCostMs = 0;
    this.emaInitialized = false;
    this.predictivePressureFrames = 0;
  }

  private updateEma(metrics: RendererQualityMetrics): void {
    if (!this.emaInitialized) {
      this.emaFrameCostMs = metrics.durationMs;
      this.emaInitialized = true;
    } else {
      this.emaFrameCostMs = EMA_ALPHA * metrics.durationMs + (1 - EMA_ALPHA) * this.emaFrameCostMs;
    }
  }

  private isPredictivePressure(metrics: RendererQualityMetrics): boolean {
    if (metrics.targetFrameMs <= 0) return false;
    // Don't predict pressure when the current frame is fast — EMA will decay
    // naturally and recovery should proceed unimpeded.
    if (metrics.durationMs <= metrics.targetFrameMs * FAST_RECOVER_RATIO) return false;
    return this.emaFrameCostMs > metrics.targetFrameMs * PREDICTIVE_PRESSURE_RATIO;
  }

  private isEmaWellUnderBudget(metrics: RendererQualityMetrics): boolean {
    if (metrics.targetFrameMs <= 0) return false;
    return this.emaFrameCostMs <= metrics.targetFrameMs * FAST_RECOVER_RATIO;
  }

  private setLevel(level: RendererQualityLevel, reason: RendererQualityChangeReason): void {
    if (level === this.level) return;
    this.level = level;
    this.consecutiveOverBudgetFrames = 0;
    this.consecutiveBackpressureFrames = 0;
    this.consecutiveOutputPressureFrames = 0;
    this.consecutiveUnderBudgetFrames = 0;
    this.changes++;
    this.lastChangeReason = reason;
  }
}

export function rendererQualityAllows(
  current: RendererQualityLevel,
  required: RendererQualityLevel,
): boolean {
  return qualityIndex(current) >= qualityIndex(required);
}

function isOverBudget(metrics: RendererQualityMetrics): boolean {
  return metrics.overBudget || metrics.durationMs > metrics.targetFrameMs;
}

function isOutputPressure(
  metrics: RendererQualityMetrics,
  outputPressureBytes: number,
  outputPressureCellRatio: number,
): boolean {
  if ((metrics.outputBytes ?? 0) >= outputPressureBytes) return true;
  const totalCells = metrics.totalCells ?? 0;
  if (totalCells <= 0) return false;
  return (metrics.changedCells ?? 0) / totalCells >= outputPressureCellRatio;
}

function isSafelyUnderBudget(
  metrics: RendererQualityMetrics,
  ratio: number,
): boolean {
  return metrics.targetFrameMs <= 0 || metrics.durationMs <= metrics.targetFrameMs * ratio;
}

function stepQualityLevel(
  level: RendererQualityLevel,
  direction: -1 | 1,
): RendererQualityLevel {
  const nextIndex = Math.min(
    QUALITY_LEVELS.length - 1,
    Math.max(0, qualityIndex(level) + direction),
  );
  return QUALITY_LEVELS[nextIndex]!;
}

function qualityIndex(level: RendererQualityLevel): number {
  return QUALITY_LEVELS.indexOf(level);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeRatio(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(1, value);
}
