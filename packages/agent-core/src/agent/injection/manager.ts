import type { Agent } from '..';
import { formatTaskList } from '#/tools/background/task-list';
import { ContextOSInjector } from './context-os';
import { CurrentTimeInjector } from './current-time';
import { GoalInjector } from './goal';
import { HarnessInjector } from '../refine/injector';
import type { DynamicInjector } from './injector';
import { ToolWorkflowInjector } from './tool-workflow-injector';
import { MemoryInjector } from './memory';
import { PermissionModeInjector } from './permission-mode';
import { AskModeInjector } from './ask-mode';
import { PlanModeInjector } from './plan-mode';
import { PremiumQualityInjector } from './premium-quality';
import { ResponseLanguageInjector } from './response-language';
import { TodoListReminderInjector } from './todo-list';
import { JobDeskInjector } from './job-desk';
import { FleetModelCatalogInjector } from './fleet-model-catalog';
import { MediaReadinessInjector } from './media-readiness';
import { WindowsTerminalReadinessInjector } from './windows-terminal-readiness';
import { TASK_GRAPH_STORE_KEY } from '../../tools/builtin/state/task-graph-store-key';

const ACTIVE_BACKGROUND_TASK_GUIDANCE =
  'Context compacted; background tasks still run. Do not start duplicates — TaskOutput for results, TaskList, TaskStop to cancel.';

const TASK_GRAPH_INJECTION_MAX_CHARS = 3_500;

/**
 * Batched per-step injection budget. The batch message is append-only tail
 * content re-read on every request, so a runaway contributor (large memory
 * block, workflow dump) must not flood it unbounded. Parts are trimmed
 * head-first with a marker; caps are generous enough that normal batches
 * (~3-6k chars) never trip them.
 */
export const INJECTION_PART_MAX_CHARS = 10_000;
export const INJECTION_BATCH_MAX_CHARS = 20_000;

const INJECTION_TRIM_MARKER = '\n…[trimmed for injection budget]';

/** Head-first trim of one contribution so a note about the cut survives. */
function trimInjectionPart(part: string, limit: number): string {
  if (part.length <= limit) return part;
  return `${part.slice(0, limit - INJECTION_TRIM_MARKER.length)}${INJECTION_TRIM_MARKER}`;
}

/**
 * Enforce the per-part and total batch budgets. When the total still exceeds
 * the batch cap after per-part trimming, the largest part keeps shrinking —
 * small contributors are never dropped outright.
 */
function capBatchParts(parts: readonly string[]): string[] {
  const capped = parts.map((part) => trimInjectionPart(part, INJECTION_PART_MAX_CHARS));
  let total = capped.reduce((sum, part) => sum + part.length, 0);
  while (total > INJECTION_BATCH_MAX_CHARS) {
    let largest = 0;
    for (let i = 1; i < capped.length; i++) {
      if ((capped[i] ?? '').length > (capped[largest] ?? '').length) largest = i;
    }
    const current = capped[largest] ?? '';
    if (current.length <= INJECTION_TRIM_MARKER.length) break;
    const nextLength = Math.max(
      INJECTION_TRIM_MARKER.length,
      current.length - (total - INJECTION_BATCH_MAX_CHARS),
    );
    capped[largest] = trimInjectionPart(current, nextLength);
    total = capped.reduce((sum, part) => sum + part.length, 0);
  }
  return capped;
}

export { capBatchParts as __testing__capBatchParts };

export class InjectionManager {
  private readonly injectors: DynamicInjector[];
  private readonly jobDeskInjector: JobDeskInjector;
  // Goal context is injected at continuation boundaries (turn start, each
  // continuation, after compaction) via `injectGoal()`, NOT in the per-step
  // `inject()` loop. Boundary-cadence append-only injection keeps one fresh copy
  // near the tail without mutating the prefix, so prompt caching is preserved and
  // the context does not grow O(n^2) the way per-step injection did.
  private goalInjector: GoalInjector | null;

  constructor(protected readonly agent: Agent) {
    this.jobDeskInjector = new JobDeskInjector(agent);
    this.injectors = [
      new CurrentTimeInjector(agent),
      new MemoryInjector(agent),
      new ToolWorkflowInjector(agent),
      new TodoListReminderInjector(agent),
      this.jobDeskInjector,
      new FleetModelCatalogInjector(agent),
      new MediaReadinessInjector(agent),
      new WindowsTerminalReadinessInjector(agent),
      new AskModeInjector(agent),
      new PlanModeInjector(agent),
      new PremiumQualityInjector(agent),
      new PermissionModeInjector(agent),
      new ResponseLanguageInjector(agent),
      new ContextOSInjector(agent),
      new HarnessInjector(agent),
    ];
    this.goalInjector = agent.type === 'main' ? new GoalInjector(agent) : null;
  }

  async inject(): Promise<void> {
    // Batch all per-step injections into a single system-reminder message.
    // This reduces conversation-structure volatility (1 message instead of up
    // to 10) so the provider's prefix cache sees a stable tail shape and only
    // the newest batch content is processed as new input.
    const parts: string[] = [];
    const contributors: DynamicInjector[] = [];
    for (const injector of this.injectors) {
      const text = await injector.collectForBatch();
      if (text !== undefined) {
        parts.push(text);
        contributors.push(injector);
      }
    }
    if (parts.length > 0) {
      const index = this.agent.context.history.length;
      this.agent.context.appendSystemReminder(capBatchParts(parts).join('\n\n'), {
        kind: 'injection',
        variant: 'batch',
      });
      for (const injector of contributors) {
        injector.markBatchInjected(index);
      }
    }
  }

  /**
   * Appends a fresh goal-context reminder at a continuation boundary. Append-only
   * (never mutates the prefix) so prompt caching is preserved; no-ops when goal
   * mode is off, the agent carries no goal (main-only by creation, or a
   * migrated goal-driver worker), or there is nothing to inject.
   */
  async injectGoal(): Promise<void> {
    await this.activeGoalInjector()?.inject();
  }

  async injectAfterCompaction(): Promise<void> {
    await this.injectGoal();
    this.injectActiveBackgroundTasks();
    this.injectTaskGraphStatus();
    this.jobDeskInjector.injectPostCompaction();
    await this.inject();
  }

  onContextClear(): void {
    for (const injector of this.lifecycleInjectors()) {
      injector.onContextClear();
    }
  }

  onContextCompacted(compactedCount: number, keptHeadCount: number = 0): void {
    for (const injector of this.lifecycleInjectors()) {
      try {
        injector.onContextCompacted(compactedCount, keptHeadCount);
      } catch {
        continue;
      }
    }
  }

  onContextMessageRemoved(index: number): void {
    for (const injector of this.lifecycleInjectors()) {
      injector.onContextMessageRemoved(index);
    }
  }

  /** Per-step injectors plus the boundary goal injector, for lifecycle events. */
  private lifecycleInjectors(): DynamicInjector[] {
    const goalInjector = this.activeGoalInjector();
    return goalInjector === null ? this.injectors : [goalInjector, ...this.injectors];
  }

  private activeGoalInjector(): GoalInjector | null {
    if (this.goalInjector === null && this.agent.goal.getGoal().goal !== null) {
      // Goal-driver worker (spec 2026-08-04-goal-driver-jobs): the goal is
      // migrated onto the subagent after construction, so the injector comes
      // online the moment a goal exists — subagents never create goals on
      // their own, which keeps this scoped to migrated drivers.
      this.goalInjector = new GoalInjector(this.agent);
    }
    return this.goalInjector;
  }

  private injectActiveBackgroundTasks(): void {
    const tasks = this.agent.background.list(true);
    if (tasks.length === 0) return;
    this.agent.context.appendSystemReminder(
      `${ACTIVE_BACKGROUND_TASK_GUIDANCE}\n\n${formatTaskList(tasks, true)}`,
      { kind: 'injection', variant: 'background_task_status' },
    );
  }

  private injectTaskGraphStatus(): void {
    if (this.agent.type !== 'main') return;
    const graph = this.agent.tools.getStore().get(TASK_GRAPH_STORE_KEY);
    if (graph === undefined || graph.nodes.length === 0) return;

    const lines = [
      '<task_graph_status>',
      'Post-compaction TaskGraph (continue assigned nodes):',
    ];

    {
      // Prefer non-done nodes; fall back to a short done sample only if nothing pending.
      const pending = graph.nodes.filter((node) => node.status !== 'done');
      const nodes =
        pending.length > 0
          ? pending
          : graph.nodes.filter((node) => node.status === 'done');
      const limit = 16;
      for (const node of nodes.slice(0, limit)) {
        lines.push(`- ${node.id}: ${node.status} — ${node.title}`);
      }
      if (nodes.length > limit) {
        lines.push(`- … ${String(nodes.length - limit)} more`);
      }
    }

    lines.push('</task_graph_status>');

    let text = lines.join('\n');
    if (text.length > TASK_GRAPH_INJECTION_MAX_CHARS) {
      text = `${text.slice(0, TASK_GRAPH_INJECTION_MAX_CHARS - 24)}\n… [truncated]\n</task_graph_status>`;
    }

    this.agent.context.appendSystemReminder(text, {
      kind: 'injection',
      variant: 'task_graph_status',
    });
  }
}
