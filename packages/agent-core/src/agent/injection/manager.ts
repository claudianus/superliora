import type { Agent } from '..';
import { formatTaskList } from '#/tools/background/task-list';
import { ContextOSInjector } from './context-os';
import { GoalInjector } from './goal';
import type { DynamicInjector } from './injector';
import { LeanContextInjector } from './lean-context-injector';
import { MemoryInjector } from './memory';
import { PermissionModeInjector } from './permission-mode';
import { PluginSessionStartInjector } from './plugin-session-start';
import { PlanModeInjector } from './plan-mode';
import { ResponseLanguageInjector } from './response-language';
import { TodoListReminderInjector } from './todo-list';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../../tools/builtin/state/ultrawork-graph';

const ACTIVE_BACKGROUND_TASK_GUIDANCE =
  'Context was compacted but background tasks still run. Do not start duplicates — TaskOutput for results, TaskList to enumerate, TaskStop to cancel.';

export class InjectionManager {
  private readonly injectors: DynamicInjector[];
  // Goal context is injected at continuation boundaries (turn start, each
  // continuation, after compaction) via `injectGoal()`, NOT in the per-step
  // `inject()` loop. Boundary-cadence append-only injection keeps one fresh copy
  // near the tail without mutating the prefix, so prompt caching is preserved and
  // the context does not grow O(n^2) the way per-step injection did.
  private readonly goalInjector: GoalInjector | null;

  constructor(protected readonly agent: Agent) {
    this.injectors = [
      new PluginSessionStartInjector(agent),
      new MemoryInjector(agent),
      new LeanContextInjector(agent),
      new ContextOSInjector(agent),
      new TodoListReminderInjector(agent),
      new PlanModeInjector(agent),
      new PermissionModeInjector(agent),
      new ResponseLanguageInjector(agent),
    ];
    this.goalInjector = agent.type === 'main' ? new GoalInjector(agent) : null;
  }

  async inject(): Promise<void> {
    for (const injector of this.injectors) {
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
    await this.inject();
  }

  onContextClear(): void {
    for (const injector of this.lifecycleInjectors()) {
      injector.onContextClear();
    }
  }

  onContextCompacted(compactedCount: number): void {
    for (const injector of this.lifecycleInjectors()) {
      try {
        injector.onContextCompacted(compactedCount);
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
    if (this.agent.ultraSwarmRun !== undefined) return;
    const graph = this.agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined || graph.nodes.length === 0) return;
    const lines = [
      '<ultrawork_graph_status>',
      'Post-compaction UltraworkGraph node status (continue assigned nodes from here):',
    ];
    for (const node of graph.nodes.slice(0, 32)) {
      lines.push(`- ${node.id}: ${node.status} — ${node.title}`);
    }
    lines.push('</ultrawork_graph_status>');
    this.agent.context.appendSystemReminder(lines.join('\n'), {
      kind: 'injection',
      variant: 'ultrawork_graph_status',
    });
  }
}
