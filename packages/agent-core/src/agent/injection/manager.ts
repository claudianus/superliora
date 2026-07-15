import type { Agent } from '..';
import { formatTaskList } from '#/tools/background/task-list';
import { ContextOSInjector } from './context-os';
import { CurrentTimeInjector } from './current-time';
import { GoalInjector } from './goal';
import type { DynamicInjector } from './injector';
import { LeanContextInjector } from './lean-context-injector';
import { MemoryInjector } from './memory';
import { PermissionModeInjector } from './permission-mode';
import { PluginSessionStartInjector } from './plugin-session-start';
import { PlanModeInjector } from './plan-mode';
import { PremiumQualityInjector } from './premium-quality';
import { ResponseLanguageInjector } from './response-language';
import { TodoListReminderInjector } from './todo-list';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../../tools/builtin/state/ultrawork-graph';
import { injectUltraworkPostCompactionContinuation } from '../../ultrawork/recovery';

const ACTIVE_BACKGROUND_TASK_GUIDANCE =
  'Context was compacted but background tasks still run. Do not start duplicates — TaskOutput for results, TaskList to list, TaskStop to cancel.';

const ULTRAWORK_GRAPH_INJECTION_MAX_CHARS = 3_500;

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
      new CurrentTimeInjector(agent),
      new PluginSessionStartInjector(agent),
      new MemoryInjector(agent),
      new LeanContextInjector(agent),
      new ContextOSInjector(agent),
      new TodoListReminderInjector(agent),
      new PlanModeInjector(agent),
      new PremiumQualityInjector(agent),
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
    injectUltraworkPostCompactionContinuation(this.agent);
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
    const graph = this.agent.tools.getStore().get(ULTRAWORK_GRAPH_STORE_KEY);
    const run = this.agent.ultrawork?.getRun();
    const duringSwarm = this.agent.ultraSwarmRun !== undefined;
    if (graph === undefined || graph.nodes.length === 0) {
      if (run === null || run === undefined || run.status !== 'running') return;
    }

    const lines = [
      '<ultrawork_graph_status>',
      duringSwarm
        ? 'Post-compaction UltraworkGraph (UltraSwarm active — continue assigned nodes):'
        : 'Post-compaction UltraworkGraph node status (continue assigned nodes):',
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
      const limit = duringSwarm ? 6 : 16;
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
