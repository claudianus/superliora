const QUALITY_ROLLING_WINDOW = 5;
const LOW_QUALITY_THRESHOLD = 0.75;

export interface CompactionQualityTrend {
  readonly sampleCount: number;
  readonly rollingAverage: number | null;
  readonly lowQualityStreak: number;
  readonly emergencyBackstopCount: number;
  readonly evidenceRepairAttempts: number;
  readonly evidenceRepairSuccesses: number;
  readonly evidenceRepairSuccessRate: number | null;
}

/**
 * Rolling compaction-quality feedback used to bias future trigger thresholds.
 * When recent summaries score poorly or require the emergency backstop, compaction
 * fires earlier on subsequent turns.
 */
export class CompactionQualityTracker {
  private readonly scores: number[] = [];
  private lowQualityStreak = 0;
  private emergencyBackstopCount = 0;
  private evidenceRepairAttempts = 0;
  private evidenceRepairSuccesses = 0;

  record(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
    readonly evidenceRepairAttempted?: boolean;
    readonly evidenceRepairSucceeded?: boolean;
  }): CompactionQualityTrend {
    if (input.evidenceRepairAttempted === true) {
      this.evidenceRepairAttempts += 1;
      if (input.evidenceRepairSucceeded === true) {
        this.evidenceRepairSuccesses += 1;
      }
    }
    if (input.usedEmergencyBackstop) {
      this.emergencyBackstopCount += 1;
      this.lowQualityStreak += 1;
    } else if (input.recallEvalScore !== undefined) {
      this.scores.push(input.recallEvalScore);
      if (this.scores.length > QUALITY_ROLLING_WINDOW) {
        this.scores.shift();
      }
      if (input.recallEvalScore < LOW_QUALITY_THRESHOLD) {
        this.lowQualityStreak += 1;
      } else {
        this.lowQualityStreak = 0;
      }
    }
    return this.trend();
  }

  trend(): CompactionQualityTrend {
    const evidenceRepairSuccessRate =
      this.evidenceRepairAttempts === 0
        ? null
        : Number((this.evidenceRepairSuccesses / this.evidenceRepairAttempts).toFixed(3));
    if (this.scores.length === 0) {
      return {
        sampleCount: 0,
        rollingAverage: null,
        lowQualityStreak: this.lowQualityStreak,
        emergencyBackstopCount: this.emergencyBackstopCount,
        evidenceRepairAttempts: this.evidenceRepairAttempts,
        evidenceRepairSuccesses: this.evidenceRepairSuccesses,
        evidenceRepairSuccessRate,
      };
    }
    const rollingAverage = Number(
      (this.scores.reduce((sum, score) => sum + score, 0) / this.scores.length).toFixed(3),
    );
    return {
      sampleCount: this.scores.length,
      rollingAverage,
      lowQualityStreak: this.lowQualityStreak,
      emergencyBackstopCount: this.emergencyBackstopCount,
      evidenceRepairAttempts: this.evidenceRepairAttempts,
      evidenceRepairSuccesses: this.evidenceRepairSuccesses,
      evidenceRepairSuccessRate,
    };
  }
}

