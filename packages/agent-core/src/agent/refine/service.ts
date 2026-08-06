/**
 * AgentRefineService — the continual-harness refine pipeline.
 *
 * A refine run serializes the recent trajectory, asks a cheap logic-only
 * model for harness edits (prompt notes, memory records, skills, subagent
 * specs), applies them with before/after snapshots, and persists the
 * result. Local scope rides the session record log; global scope lives in a
 * JSON file under the liora home dir. Rollback replays the inverse of an
 * applied event.
 *
 * Auto-refine mirrors AutoDreamService: turn-end scheduling, flag-gated,
 * in-flight guarded, fire-and-forget.
 */

import type { Agent } from '..';
import { applyHarnessEdit, rollbackHarnessEvent } from './apply';
import {
  loadGlobalHarnessState,
  resolveGlobalLioraHome,
  saveGlobalHarnessState,
} from './persist';
import { planRefinement, type HarnessEdit } from './plan';
import { reviewAutoRefine } from './review';
import {
  appendRefinementEvent,
  emptyHarnessState,
  findEntry,
  findRollbackableEvent,
  harnessContentHash,
  renderHarnessPromptSection,
  renderHarnessRosterSection,
  upsertEntry,
  type HarnessEntry,
  type HarnessRefinementEvent,
  type HarnessScope,
  type HarnessState,
} from './state';

export const AUTO_REFINE_TURN_INTERVAL = 25;
export const AUTO_REFINE_POST_COMPACT_MIN_TURNS = 3;
/**
 * Prime parity (cooldownMs 20min): at most one auto attempt per window, and
 * never in the first window after agent construction. The wall-clock floor
 * also keeps the auto path inert in tests, which run 25 turns in seconds.
 */
export const AUTO_REFINE_COOLDOWN_MS = 20 * 60 * 1000;

export interface RefineRunOptions {
  readonly scope?: HarnessScope;
  readonly instructions?: string;
  readonly auto?: boolean;
}

export interface RefineRunResult {
  readonly scope: HarnessScope;
  readonly summary: string;
  readonly applied: readonly HarnessRefinementEvent[];
  readonly failed: readonly HarnessRefinementEvent[];
}

export interface HarnessStatusSnapshot {
  readonly promptNotes: number;
  readonly subagentSpecs: number;
  readonly refinements: number;
  readonly lastRefinedAt: number | null;
  readonly inFlight: boolean;
  readonly turnsSinceRefine: number;
}

/** JSON-safe status view for RPC/TUI (entries + recent refinement events). */
export interface HarnessStatusView {
  readonly snapshot: HarnessStatusSnapshot;
  readonly entries: readonly HarnessEntry[];
  readonly refinements: readonly HarnessRefinementEvent[];
}

export class AgentRefineService {
  private readonly localState: HarnessState = emptyHarnessState();
  private globalState: HarnessState | null = null;
  private inFlight = false;
  private autoInFlight = false;
  private turnsSinceRefine = 0;
  private lastRefinedAt = 0;
  private readonly now: () => number;
  private readonly createdAt: number;
  private lastAutoAttemptAt: number | null = null;

  constructor(
    private readonly agent: Agent,
    options?: { readonly now?: () => number },
  ) {
    this.now = options?.now ?? Date.now;
    this.createdAt = this.now();
  }

  /** Merged view: global entries + session-local entries. */
  state(): HarnessState {
    const global = this.globalState ?? emptyHarnessState();
    return {
      schema: this.localState.schema,
      entries: [...global.entries, ...this.localState.entries],
      refinements: [...global.refinements, ...this.localState.refinements],
    };
  }

  snapshot(): HarnessStatusSnapshot {
    const merged = this.state();
    return {
      promptNotes: merged.entries.filter((entry) => entry.kind === 'prompt').length,
      subagentSpecs: merged.entries.filter((entry) => entry.kind === 'subagent').length,
      refinements: merged.refinements.length,
      lastRefinedAt: this.lastRefinedAt > 0 ? this.lastRefinedAt : null,
      inFlight: this.inFlight,
      turnsSinceRefine: this.turnsSinceRefine,
    };
  }

  statusView(): HarnessStatusView {
    const merged = this.state();
    return {
      snapshot: this.snapshot(),
      entries: merged.entries,
      refinements: merged.refinements,
    };
  }

  /** Prompt-notes + roster text for the harness injector; undefined when empty. */
  renderPromptInjection(): string | undefined {
    const merged = this.state();
    const sections = [
      renderHarnessPromptSection(merged),
      renderHarnessRosterSection(merged),
    ].filter((section): section is string => section !== undefined);
    return sections.length > 0 ? sections.join('\n\n') : undefined;
  }

  contentHash(): string {
    return harnessContentHash(this.state());
  }

  /** Replay hook: local state arrives as one snapshot record (last wins). */
  restoreState(state: HarnessState): void {
    this.localState.entries = state.entries;
    this.localState.refinements = state.refinements;
  }

  async refine(options: RefineRunOptions = {}): Promise<RefineRunResult> {
    const scope = options.scope ?? 'local';
    if (this.inFlight) {
      throw new Error('A refine run is already in progress.');
    }
    this.inFlight = true;
    try {
      await this.ensureGlobalLoaded();
      const plan = await planRefinement(this.agent, {
        scope,
        state: this.state(),
        ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
      });
      const applied: HarnessRefinementEvent[] = [];
      const failed: HarnessRefinementEvent[] = [];
      const targetState = scope === 'global' ? this.globalState! : this.localState;
      for (const edit of plan.edits) {
        try {
          const event = await applyHarnessEdit(
            { agent: this.agent, state: targetState, scope },
            edit as HarnessEdit,
          );
          appendRefinementEvent(targetState, event);
          applied.push(event);
        } catch (error) {
          const event: HarnessRefinementEvent = {
            id: randomEventId(),
            at: Date.now(),
            scope,
            kind: edit.kind,
            targetId: edit.targetId ?? edit.name ?? '(create)',
            summary: edit.evidence,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          };
          appendRefinementEvent(targetState, event);
          failed.push(event);
        }
      }
      if (applied.length > 0 || failed.length > 0) {
        await this.persist(scope);
      }
      this.lastRefinedAt = Date.now();
      this.turnsSinceRefine = 0;
      this.agent.log.info(
        `refine (${scope})${options.auto === true ? ' [auto]' : ''}: ${plan.summary} — ${String(applied.length)} applied, ${String(failed.length)} failed`,
      );
      return { scope, summary: plan.summary, applied, failed };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Measured-refinement loop: score every active ledger entry on a terminal
   * gate outcome, and auto-roll-back entries that correlate with regression
   * (failed ≥ 2 and more often than confirmed). Only terminal outcomes are
   * scored — a mid-goal gate failure is normal iteration, not evidence.
   * Ledger entries (prompt/subagent) only: memory/skill edits are not
   * injected into context, so a gate verdict says nothing about them.
   */
  async recordGateOutcome(outcome: 'passed' | 'exhausted'): Promise<void> {
    await this.ensureGlobalLoaded();
    for (const scope of ['local', 'global'] as const) {
      const targetState = scope === 'global' ? this.globalState : this.localState;
      if (targetState === null || targetState.entries.length === 0) continue;
      for (const entry of Array.from(targetState.entries)) {
        const score = {
          confirmed: (entry.score?.confirmed ?? 0) + (outcome === 'passed' ? 1 : 0),
          failed: (entry.score?.failed ?? 0) + (outcome === 'exhausted' ? 1 : 0),
        };
        upsertEntry(targetState, { ...entry, score });
      }
      if (outcome === 'exhausted') {
        for (const entry of Array.from(targetState.entries)) {
          if (entry.score === undefined) continue;
          if (entry.score.failed < 2 || entry.score.failed <= entry.score.confirmed) continue;
          await this.autoRollbackEntry(targetState, scope, entry);
        }
      }
      await this.persist(scope);
    }
  }

  private async autoRollbackEntry(
    targetState: HarnessState,
    scope: HarnessScope,
    entry: HarnessEntry,
  ): Promise<void> {
    const latest = [...targetState.refinements]
      .reverse()
      .find(
        (event) =>
          event.status === 'applied' &&
          event.kind === entry.kind &&
          event.targetId === entry.id,
      );
    if (latest === undefined) return;
    const found = findRollbackableEvent(targetState, latest.id);
    if (found === undefined || found.blockedBy !== undefined) return;
    try {
      await rollbackHarnessEvent({ agent: this.agent, state: targetState, scope }, found.event);
      found.event.status = 'rolled_back';
      // A rolled-back update restores the prior content — its score resets
      // with the version it returns to.
      const restored = findEntry(targetState, entry.kind, entry.id);
      if (restored?.score !== undefined) {
        upsertEntry(targetState, { ...restored, score: undefined });
      }
      this.agent.log.warn(
        `refine auto-rollback (${scope}): "${entry.title}" correlated with gate regression (${String(entry.score?.failed ?? 0)} failed vs ${String(entry.score?.confirmed ?? 0)} confirmed)`,
      );
    } catch (error) {
      this.agent.log.warn(`refine auto-rollback failed for "${entry.title}"`, error);
    }
  }

  async rollback(refinementId: string): Promise<HarnessRefinementEvent> {
    await this.ensureGlobalLoaded();
    for (const scope of ['local', 'global'] as const) {
      const targetState = scope === 'global' ? this.globalState! : this.localState;
      const found = findRollbackableEvent(targetState, refinementId);
      if (found === undefined) continue;
      if (found.blockedBy !== undefined) {
        throw new Error(
          `Cannot roll back ${refinementId}: newer refinement ${found.blockedBy.id} touched the same target. Roll that one back first.`,
        );
      }
      await rollbackHarnessEvent(
        { agent: this.agent, state: targetState, scope },
        found.event,
      );
      found.event.status = 'rolled_back';
      await this.persist(scope);
      this.agent.log.info(`refine rollback (${scope}): ${refinementId}`);
      return found.event;
    }
    throw new Error(`Refinement ${refinementId} not found.`);
  }

  /** Turn-end hook (mirrors AutoDreamService.maybeSchedule). */
  maybeAutoRefine(reason: 'turn' | 'compaction'): void {
    if (!this.agent.experimentalFlags.enabled('auto_refine')) return;
    if (this.agent.type !== 'main') return;
    this.turnsSinceRefine += reason === 'turn' ? 1 : 0;
    const due =
      reason === 'compaction'
        ? this.turnsSinceRefine >= AUTO_REFINE_POST_COMPACT_MIN_TURNS
        : this.turnsSinceRefine >= AUTO_REFINE_TURN_INTERVAL;
    if (!due || this.inFlight || this.autoInFlight) return;
    if (this.agent.context.history.length === 0) return;
    const anchor = this.lastAutoAttemptAt ?? this.createdAt;
    if (this.now() - anchor < AUTO_REFINE_COOLDOWN_MS) return;
    this.autoInFlight = true;
    this.lastAutoAttemptAt = this.now();
    void this.runAutoRefine()
      .catch((error: unknown) => {
        this.agent.log.warn('auto-refine failed', error);
      })
      .finally(() => {
        this.autoInFlight = false;
      });
  }

  /**
   * Review-gated auto run: the gate decides whether the trajectory justifies
   * a planning call and hands the planner a focus sentence when it does.
   */
  private async runAutoRefine(): Promise<void> {
    await this.ensureGlobalLoaded();
    const review = await reviewAutoRefine(this.agent, { state: this.state() });
    this.turnsSinceRefine = 0; // reviewed this stretch either way; don't re-ask next turn
    if (!review.shouldRefine) {
      this.agent.log.info(`auto-refine skipped: ${review.rationale}`);
      return;
    }
    await this.refine({
      scope: 'local',
      auto: true,
      ...(review.instructions !== undefined && review.instructions.trim().length > 0
        ? { instructions: review.instructions }
        : {}),
    });
  }

  private async ensureGlobalLoaded(): Promise<void> {
    if (this.globalState !== null) return;
    this.globalState = await loadGlobalHarnessState(resolveGlobalLioraHome());
  }

  private async persist(scope: HarnessScope): Promise<void> {
    if (scope === 'global') {
      if (this.globalState === null) return;
      await saveGlobalHarnessState(resolveGlobalLioraHome(), this.globalState);
      return;
    }
    this.agent.records.logRecord({
      type: 'harness.state',
      state: {
        schema: this.localState.schema,
        entries: this.localState.entries,
        refinements: this.localState.refinements,
      },
    });
  }
}

function randomEventId(): string {
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
