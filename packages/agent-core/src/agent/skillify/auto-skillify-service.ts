/**
 * Turn-end / Job-completion scheduler for auto-skillify (deterministic
 * experience → SKILL.md). Mirrors AutoDreamService / AgentRefineService:
 * flag-gated, main-only, fire-and-forget, cooldown so we don't thrash the
 * skills dir. Worker trajectories feed via ingestWorkerEvents.
 */

import type { Agent } from '../index';
import type { ToolCallEvent } from '../../skill/auto-skillify';
import {
  extractToolCallEventsFromHistory,
  runAutoSkillifyFromEvents,
} from '../../skill/auto-skillify-runtime';

/** At most one auto-skillify flush per this window (Prime-style cooldown, shorter). */
export const AUTO_SKILLIFY_COOLDOWN_MS = 5 * 60 * 1000;

/** Cap pending worker events so a flood of Jobs cannot unbounded-grow memory. */
const PENDING_WORKER_EVENTS_CAP = 400;

export interface AutoSkillifySnapshot {
  readonly enabled: boolean;
  readonly inFlight: boolean;
  readonly runs: number;
  readonly lastWritten: number;
  readonly lastRunAt: number | null;
  readonly pendingWorkerEvents: number;
}

export class AutoSkillifyService {
  private inFlight = false;
  private runs = 0;
  private lastWritten = 0;
  private lastRunAt: number | null = null;
  private pendingWorkerEvents: ToolCallEvent[] = [];
  private readonly now: () => number;
  private readonly createdAt: number;

  constructor(
    private readonly agent: Agent,
    options?: { readonly now?: () => number },
  ) {
    this.now = options?.now ?? Date.now;
    this.createdAt = this.now();
  }

  snapshot(): AutoSkillifySnapshot {
    return {
      enabled: this.agent.experimentalFlags.enabled('auto_skillify'),
      inFlight: this.inFlight,
      runs: this.runs,
      lastWritten: this.lastWritten,
      lastRunAt: this.lastRunAt,
      pendingWorkerEvents: this.pendingWorkerEvents.length,
    };
  }

  /**
   * Queue tool events from a finished Job/subagent worker, then schedule a flush.
   * Worker recoveries never appear on the Conductor main history otherwise.
   */
  ingestWorkerEvents(events: readonly ToolCallEvent[]): void {
    if (events.length === 0) return;
    this.pendingWorkerEvents.push(...events);
    if (this.pendingWorkerEvents.length > PENDING_WORKER_EVENTS_CAP) {
      this.pendingWorkerEvents = this.pendingWorkerEvents.slice(-PENDING_WORKER_EVENTS_CAP);
    }
    this.maybeSchedule('job');
  }

  /** Turn-end / Job hook — non-blocking. */
  maybeSchedule(reason: 'turn' | 'job' = 'turn'): void {
    if (!this.agent.experimentalFlags.enabled('auto_skillify')) return;
    if (this.agent.type !== 'main') return;
    if (this.inFlight) return;
    if (this.agent.skills === null) return;
    const hasWorkerPending = this.pendingWorkerEvents.length > 0;
    if (this.agent.context.history.length === 0 && !hasWorkerPending) return;
    // Job with pending worker recoveries is high-signal — still cooldown-gated
    // so a burst of Jobs cannot spam SKILL.md writes.
    const anchor = this.lastRunAt ?? this.createdAt;
    if (this.now() - anchor < AUTO_SKILLIFY_COOLDOWN_MS) return;

    this.inFlight = true;
    this.lastRunAt = this.now();
    void this.run()
      .catch((error: unknown) => {
        this.agent.log.warn('auto-skillify failed', error);
      })
      .finally(() => {
        this.inFlight = false;
      });
  }

  private async run(): Promise<void> {
    const workerEvents = this.pendingWorkerEvents.splice(0);
    const historyEvents = extractToolCallEventsFromHistory(this.agent.context.history);
    const events = [...historyEvents, ...workerEvents];
    const result = await runAutoSkillifyFromEvents(this.agent, events);
    this.runs += 1;
    this.lastWritten = result.written.length;
    if (result.written.length > 0) {
      this.agent.log.info(
        `auto-skillify wrote ${String(result.written.length)} skill(s) from ${String(result.examined)} tool events`,
      );
    }
  }
}
