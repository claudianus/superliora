import { z } from 'zod';

import type { FullCompaction } from '../../agent/compaction';
import type { ContextMemory } from '../../agent/context';
import { AgentBackgroundTask, type BackgroundManager, type BackgroundTaskInfo } from '../../agent/background';
import type { BuiltinTool } from '../../agent/tool';
import { ToolAccesses } from '../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../loop/types';
import type { SessionSubagentHost } from '../../session/subagent/subagent-host';
import { toInputJsonSchema } from '../support/input-schema';

export type SessionControlHost = Pick<SessionSubagentHost, 'spawn' | 'resume' | 'listActive' | 'steerChild' | 'stopAndJoin' | 'markActiveChildDetached'>;

export const SessionControlInputSchema = z.object({
  operation: z.enum(['spawn', 'list', 'message', 'wait', 'stop', 'compact']),
  prompt: z.string().min(1).optional().describe('Required for spawn: full child task prompt.'),
  description: z.string().min(1).optional().describe('Required for spawn: short UI label.'),
  id: z.string().min(1).optional().describe('Required for message/wait/stop: session or task ID.'),
  message: z.string().min(1).optional().describe('Required for message: input for the child.'),
  model: z.string().optional().describe('spawn: model alias; defaults to the parent model.'),
  timeout: z.number().min(0).optional().describe('Seconds: spawn run limit (0=unlimited); wait maximum (default 30, 0=current output).'),
  cwd: z.string().min(1).optional().describe('spawn: deliberately selected child working directory or existing isolated worktree.'),
  ownership: z.array(z.string().min(1)).optional().describe('spawn: optional file ownership claims.'),
  reason: z.string().optional().describe('stop: optional reason.'),
  instruction: z.string().optional().describe('compact: what the summary should preserve.'),
  summary: z.string().min(1).optional().describe('compact: self-authored context summary; skips a summarization model call.'),
}).strict();

export type SessionControlInput = z.infer<typeof SessionControlInputSchema>;

export class SessionControlTool implements BuiltinTool<SessionControlInput> {
  readonly name = 'SessionControl' as const;
  readonly description = 'Spawn autonomous child sessions, list sessions and background processes, message a child, wait for output, stop work, or compact this conversation. Use session or task IDs returned by spawn/list/Bash. Spawn returns immediately; message steers a running child or resumes an idle child. Wait timeout is seconds; 0 reads current output without waiting.';
  readonly parameters = toInputJsonSchema(SessionControlInputSchema);

  constructor(
    private readonly agent: {
      readonly context: Pick<ContextMemory, 'tokenCountWithPending'>;
      readonly fullCompaction: Pick<FullCompaction, 'begin' | 'cancel' | 'waitUntilSettled' | 'getEffectiveMaxContextTokens'>;
    },
    private readonly manager: BackgroundManager,
    private readonly host?: SessionControlHost,
  ) {}

  resolveExecution(args: SessionControlInput): ToolExecution {
    return {
      description: args.operation === 'spawn' && args.description !== undefined ? `Spawning: ${args.description}` : `Session ${args.operation}`,
      accesses: args.operation === 'compact' ? ToolAccesses.all() : ToolAccesses.none(),
      display: { kind: 'generic', summary: `Session ${args.operation}`, detail: JSON.stringify(args, null, 2) },
      approvalRule: this.name,
      execute: (context) => this.execute(args, context),
    };
  }

  private taskFor(id: string): BackgroundTaskInfo | undefined {
    return this.manager.getTask(id) ?? this.manager.list(false).findLast((task) => task.kind === 'agent' && task.agentId === id);
  }

  private async execute(args: SessionControlInput, context: ExecutableToolContext): Promise<ExecutableToolResult> {
    context.signal.throwIfAborted();
    if (args.operation === 'spawn' && (args.prompt === undefined || args.description === undefined)) {
      return { isError: true, output: 'spawn requires prompt and description.' };
    }
    if ((args.operation === 'message' || args.operation === 'wait' || args.operation === 'stop') && args.id === undefined) {
      return { isError: true, output: `${args.operation} requires id.` };
    }
    if (args.operation === 'message' && args.message === undefined) {
      return { isError: true, output: 'message requires message text.' };
    }
    switch (args.operation) {
      case 'list':
        return { output: JSON.stringify({ tasks: this.manager.list(false), sessions: this.host?.listActive() ?? [] }) };
      case 'spawn':
        return this.launch(args.prompt!, args.description!, context, args);
      case 'message': {
        const task = this.taskFor(args.id!);
        const agentId = task?.kind === 'agent' ? task.agentId : args.id;
        if (agentId === undefined || this.host === undefined) return { isError: true, output: 'Child session host is unavailable.' };
        if (this.host.steerChild(agentId, [{ type: 'text', text: args.message! }])) {
          return { output: JSON.stringify({ agentId, delivered: true }) };
        }
        return this.launch(args.message!, `Message ${agentId}`, context, {}, agentId);
      }
      case 'wait': {
        const task = this.taskFor(args.id!);
        if (task === undefined) return { isError: true, output: `Session or task not found: ${args.id}` };
        const timeout = args.timeout ?? 30;
        if (timeout > 0) {
          await this.manager.waitForActiveTasks((entry) => entry.taskId === task.taskId, { timeoutMs: timeout * 1000, signal: context.signal });
        }
        context.signal.throwIfAborted();
        const current = this.manager.getTask(task.taskId) ?? task;
        const output = await this.manager.getOutputSnapshot(task.taskId, 32 * 1024);
        return { output: JSON.stringify({ ...current, output }), isError: current.status !== 'running' && current.status !== 'completed' };
      }
      case 'stop': {
        const task = this.taskFor(args.id!);
        if (task !== undefined) {
          const stopped = await this.manager.stop(task.taskId, args.reason);
          if (stopped !== undefined) return { output: JSON.stringify(stopped) };
        }
        if (await this.host?.stopAndJoin(args.id!, args.reason) === true) {
          return { output: JSON.stringify({ agentId: args.id, cancelRequested: true, resourcesSettled: true }) };
        }
        return { isError: true, output: `No live session or task found: ${args.id}` };
      }
      case 'compact': {
        const before = this.agent.context.tokenCountWithPending;
        const compaction = this.agent.fullCompaction;
        const cancel = (): void => compaction.cancel();
        context.signal.addEventListener('abort', cancel, { once: true });
        try {
          compaction.begin({ source: 'agent', instruction: args.instruction, summary: args.summary });
          if (context.signal.aborted) cancel();
          await compaction.waitUntilSettled();
          context.signal.throwIfAborted();
        } finally {
          context.signal.removeEventListener('abort', cancel);
        }
        return { output: JSON.stringify({ tokensBefore: before, tokensAfter: this.agent.context.tokenCountWithPending, maxContextTokens: compaction.getEffectiveMaxContextTokens() }) };
      }
    }
  }

  private async launch(prompt: string, description: string, context: ExecutableToolContext, selection: Pick<SessionControlInput, 'model' | 'timeout' | 'cwd' | 'ownership'> = {}, resumeId?: string): Promise<ExecutableToolResult> {
    if (this.host === undefined) return { isError: true, output: 'Child sessions require a session host.' };
    const controller = new AbortController();
    const abort = (): void => controller.abort(context.signal.reason);
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      context.signal.throwIfAborted();
      const options = {
        prompt, description, parentToolCallId: context.toolCallId,
        runInBackground: true, signal: controller.signal,
        ...(selection.timeout === undefined ? {} : { timeoutMs: selection.timeout * 1000 }),
        ...(selection.model === undefined ? {} : { modelAlias: selection.model }),
        ...(selection.cwd === undefined ? {} : { worktreeDir: selection.cwd }),
        ...(selection.ownership === undefined ? {} : { ownership: selection.ownership }),
      };
      const handle = resumeId === undefined
        ? await this.host.spawn({ ...options, profileName: 'agent' })
        : await this.host.resume(resumeId, options);
      try {
        const taskId = this.manager.registerTask(new AgentBackgroundTask(handle, description, this.host, controller), { detached: true });
        return { output: JSON.stringify({ agentId: handle.agentId, taskId, status: 'running' }) };
      } catch (error) {
        controller.abort(error);
        await handle.completion.catch(() => undefined);
        throw error;
      }
    } finally {
      context.signal.removeEventListener('abort', abort);
    }
  }
}
