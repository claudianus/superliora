import { readFile } from 'node:fs/promises';

import type { Agent } from '../agent';
import {
  discoverWorkflowScripts,
  type DiscoveredWorkflowScript,
} from './workflow-discover';
import {
  runWorkflowScript,
  type WorkflowAgentFn,
  type WorkflowRunResult,
} from './workflow-runtime';

export interface WorkflowHostOptions {
  readonly projectDir: string;
  readonly homeDir?: string;
  readonly pluginWorkflowDirs: readonly { pluginId: string; dir: string }[];
  /**
   * When set, `agent()` calls go through this. Tests inject a fake.
   * Default uses a text-only prompt against the main agent LLM when available.
   */
  readonly agentFn?: WorkflowAgentFn;
}

/**
 * Session-facing host for Claude dynamic workflows (plugin + .claude paths).
 */
export class WorkflowHost {
  private catalog: DiscoveredWorkflowScript[] = [];
  private readonly runs = new Map<
    string,
    { status: 'running' | 'done' | 'error' | 'stopped'; result?: WorkflowRunResult; error?: string }
  >();
  private abort: AbortController | undefined;

  constructor(
    private readonly options: WorkflowHostOptions,
    private readonly mainAgent?: Agent,
  ) {}

  async refresh(): Promise<readonly DiscoveredWorkflowScript[]> {
    this.catalog = [...(await discoverWorkflowScripts({
      pluginWorkflows: this.options.pluginWorkflowDirs,
      projectDir: this.options.projectDir,
      homeDir: this.options.homeDir,
    }))];
    return this.catalog;
  }

  list(): readonly DiscoveredWorkflowScript[] {
    return this.catalog;
  }

  async run(nameOrId: string): Promise<WorkflowRunResult> {
    if (this.catalog.length === 0) await this.refresh();
    const script =
      this.catalog.find((s) => s.id === nameOrId || s.name === nameOrId) ??
      this.catalog.find((s) => s.id.endsWith(`:${nameOrId}`));
    if (script === undefined) {
      throw new Error(`Workflow "${nameOrId}" not found`);
    }
    const source = await readFile(script.filePath, 'utf8');
    this.abort = new AbortController();
    const runId = `${script.id}:${Date.now()}`;
    this.runs.set(runId, { status: 'running' });
    try {
      const result = await runWorkflowScript({
        source,
        filePath: script.filePath,
        signal: this.abort.signal,
        agent: this.options.agentFn ?? this.defaultAgentFn(),
      });
      this.runs.set(runId, { status: 'done', result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runs.set(runId, { status: 'error', error: message });
      throw error;
    } finally {
      this.abort = undefined;
    }
  }

  stop(): void {
    this.abort?.abort();
  }

  private defaultAgentFn(): WorkflowAgentFn {
    return async (prompt, options) => {
      const agent = this.mainAgent;
      if (agent === undefined) {
        return { text: prompt, label: options?.label };
      }
      // Lightweight orchestration stub: return structured placeholder so
      // scripts can proceed without a full subagent spawn in unit tests.
      // Session wiring may replace agentFn with a real subagent runner.
      if (options?.schema !== undefined) {
        return { files: [], text: prompt, label: options.label };
      }
      return { text: prompt, label: options?.label };
    };
  }
}
