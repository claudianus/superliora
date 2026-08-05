import type { Agent } from '../index';
import type { LioraMemoryStore } from '../../memory/store';

const DEFAULT_MIN_HOURS_SINCE_LAST_DREAM = 4;
const DEFAULT_MIN_CANDIDATE_RECORDS = 8;
const MAX_RECORDS_PER_REFLECT = 200;

export interface AutoDreamOptions {
  readonly minHoursSinceLastDream?: number;
  readonly minActiveRecords?: number;
}

interface DreamResult {
  readonly examined: number;
  readonly merged: number;
}

export interface AutoDreamSnapshot {
  readonly enabled: boolean;
  readonly inFlight: boolean;
  readonly runs: number;
  readonly lastDreamAt: number | null;
  readonly lastExamined: number | null;
  readonly lastMerged: number | null;
  readonly minHours: number;
  readonly minActiveRecords: number;
}

/**
 * Compatibility scheduler for the old internal field name.
 *
 * Reflection is now deterministic and owned by LioraMemoryStore.reflect;
 * this class only decides when to invoke that operation.
 */
export class AutoDreamService {
  private inFlight = false;
  private lastDreamAt = 0;
  private runs = 0;
  private lastExamined: number | null = null;
  private lastMerged: number | null = null;
  private readonly minHours: number;
  private readonly minActiveRecords: number;

  constructor(
    private readonly agent: Agent,
    private readonly store: LioraMemoryStore,
    options: AutoDreamOptions = {},
  ) {
    this.minHours = options.minHoursSinceLastDream ?? DEFAULT_MIN_HOURS_SINCE_LAST_DREAM;
    this.minActiveRecords = options.minActiveRecords ?? DEFAULT_MIN_CANDIDATE_RECORDS;
  }

  snapshot(): AutoDreamSnapshot {
    return {
      enabled: this.agent.experimentalFlags.enabled('auto_dream'),
      inFlight: this.inFlight,
      runs: this.runs,
      lastDreamAt: this.lastDreamAt > 0 ? this.lastDreamAt : null,
      lastExamined: this.lastExamined,
      lastMerged: this.lastMerged,
      minHours: this.minHours,
      minActiveRecords: this.minActiveRecords,
    };
  }

  maybeSchedule(): void {
    if (!this.agent.experimentalFlags.enabled('auto_dream')) return;
    if (this.agent.kimiConfig?.memory?.reflectEnabled === false) return;
    if (this.inFlight) return;
    if ((Date.now() - this.lastDreamAt) / 3_600_000 < this.minHours) return;
    void this.runDream().catch((error) => {
      this.agent.log.warn('memory reflection failed', error);
    });
  }

  private async runDream(): Promise<DreamResult> {
    this.inFlight = true;
    try {
      const stats = await this.store.stats();
      if (stats.candidates < this.minActiveRecords) {
        this.lastExamined = stats.candidates;
        this.lastMerged = 0;
        return { examined: stats.candidates, merged: 0 };
      }
      const result = await this.store.reflect({ limit: MAX_RECORDS_PER_REFLECT });
      this.lastDreamAt = Date.now();
      this.runs += 1;
      this.lastExamined = result.examined;
      this.lastMerged = result.merged;
      return { examined: result.examined, merged: result.merged };
    } finally {
      this.inFlight = false;
    }
  }
}
