import type { Agent } from '..';
import { formatTaskList } from '#/tools/background/task-list';
import { ContextOSInjector } from './context-os';
import { CurrentTimeInjector } from './current-time';
import { GoalInjector } from './goal';
import type { DynamicInjector } from './injector';
import { ToolWorkflowInjector } from './tool-workflow-injector';
import { MemoryInjector } from './memory';
import { PermissionModeInjector } from './permission-mode';
import { PlanModeInjector } from './plan-mode';
import { PremiumQualityInjector } from './premium-quality';
import { ResponseLanguageInjector } from './response-language';
import { TodoListReminderInjector } from './todo-list';
import { JobDeskInjector } from './job-desk';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../../tools/builtin/state/ultrawork-graph-store-key';
import { injectUltraworkPostCompactionContinuation } from '#/mission';

const ACTIVE_BACKGROUND_TASK_GUIDANCE =
  'Context compacted; background tasks still run. Do not start duplicates — TaskOutput for results, TaskList, TaskStop to cancel.';

const ULTRAWORK_GRAPH_INJECTION_MAX_CHARS = 3_500;

export class InjectionManager {
  private readonly injectors: DynamicInjector[];
  /** Injectors whose getInjection() depends on the trailing context shape.
   * These run AFTER the main batch append so they observe the batch message
   * in the history (mirroring the old sequential behaviour where earlier
   * injectors' messages were already visible to later ones). */
  private readonly contextDependentInjectors: DynamicInjector[];
  // Goal context is injected at continuation boundaries (turn start, each
  // continuation, after compaction) via `injectGoal()`, NOT in the per-step
  // `inject()` loop. Boundary-cadence append-only injection keeps one fresh copy
  // near the tail without mutating the prefix, so prompt caching is preserved and
  // the context does not grow O(n^2) the way per-step injection did.
  private readonly goalInjector: GoalInjector | null;

  constructor(protected readonly agent: Agent) {
    this.injectors = [
      new CurrentTimeInjector(agent),
      new MemoryInjector(agent),
      new ToolWorkflowInjector(agent),
      new TodoListReminderInjector(agent),
      new JobDeskInjector(agent),
      new PlanModeInjector(agent),
      new PremiumQualityInjector(agent),
      new PermissionModeInjector(agent),
      new ResponseLanguageInjector(agent),
    ];
    this.contextDependentInjectors = [
      new ContextOSInjector(agent),
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
      this.agent.context.appendSystemReminder(parts.join('\n\n'), {
        kind: 'injection',
        variant: 'batch',
      });
      for (const injector of contributors) {
        injector.markBatchInjected(index);
      }
    }
    // Context-dependent injectors run after the batch so they observe the
    // batch message in the trailing history (preserves their guard semantics).
    for (const injector of this.contextDependentInjectors) {
      await injector.inject();
    }
  }

  /**
   * Appends a fresh goal-context reminder at a continuation boundary. Append-only
   * (never mutates the prefix) so prompt caching is preserved; no-ops when goal
   * mode is off, the agent is not the main agent, or there is nothing to inject.
   */
  async injectGoal(): Promise<void> {
    await this.activeGoalInjector()?.inject();
  }

  async injectAfterCompaction(): Promise<void> {
    await this.injectGoal();
    this.injectActiveBackgroundTasks();
    this.injectUltraworkGraphStatus();
    injectUltraworkPostCompactionContinuation(this.agent);
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
    const all = [...this.contextDependentInjectors, ...this.injectors];
    const goalInjector = this.activeGoalInjector();
    return goalInjector === null ? all : [goalInjector, ...all];
  }

  private activeGoalInjector(): GoalInjector | null {
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

  private injectUltraworkGraphStatus(): void {
    if (this.agent.type !== 'main') return;
    const graph = this.agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY);
    const run = this.agent.ultrawork?.getRun();
    if (graph === undefined || graph.nodes.length === 0) {
      if (run === null || run === undefined || run.status !== 'running') return;
    }

    const lines = [
      '<ultrawork_graph_status>',
      'Post-compaction UltraworkGraph (continue assigned nodes):',
    ];

    if (run !== null && run !== undefined) {
      lines.push(`run_id: ${run.id} | stage: ${run.stage} | status: ${run.status}`);
      const activation = this.agent.ultrawork.getActivation();
      if (activation !== undefined) {
        lines.push(`evidence_root: ${activation.evidenceRoot}`);
      }
    }

    if (graph !== undefined && graph.nodes.length > 0) {
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

    lines.push('</ultrawork_graph_status>');

    let text = lines.join('\n');
    if (text.length > ULTRAWORK_GRAPH_INJECTION_MAX_CHARS) {
      text = `${text.slice(0, ULTRAWORK_GRAPH_INJECTION_MAX_CHARS - 24)}\n… [truncated]\n</ultrawork_graph_status>`;
    }

    this.agent.context.appendSystemReminder(text, {
      kind: 'injection',
      variant: 'ultrawork_graph_status',
    });
  }
}
