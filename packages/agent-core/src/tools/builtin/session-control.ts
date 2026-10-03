import { z } from 'zod';

import type { FullCompaction } from '../../agent/compaction';
import type { ContextMemory } from '../../agent/context';
import { AgentBackgroundTask, type BackgroundManager, type BackgroundTaskInfo } from '../../agent/background';
import type { BuiltinTool } from '../../agent/tool';
import { ToolAccesses } from '../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../loop/types';
import type { SessionSubagentHost } from '../../session/subagent/subagent-host';
import { toInputJsonSchema } from '../support/input-schema';

export type SessionControlHost = Pick<SessionSubagentHost, 'spawn' | 'resume' | 'listActive' | 'steerChild' | 'stopAndJoin' | 'markActiveChildDetached'> & { readonly workerAncestry?: import('@superliora/protocol').WorkerAncestry; readonly coordination?: SessionSubagentHost['coordination']; readonly role?: 'worker' | 'interactive-conductor'; readonly contextProjection?: () => { prefix: string; dynamic: string } | undefined };

export const SessionControlInputSchema = z.object({
  planId: z.string().min(1).optional().describe('verify: trusted host-registered verification plan ID; never commands or paths.'),
  purpose: z.string().min(1).optional().describe('independent spawn: reusable session purpose.'),
  sourceRevision: z.string().min(1).optional().describe('independent spawn: host revision identity for pool selection.'),
  lane: z.enum(['worker', 'independent']).optional().describe('spawn: worker sessions default worker; conductors always dispatch independent sessions with absolute cwd.'),
  idempotencyKey: z.string().min(1).optional().describe('independent spawn/message: durable request identity; reuse only for identical input.'),
  expectedRevision: z.number().int().min(1).optional().describe('independent message/stop: reject stale projection revisions.'),
  operation: z.enum(['spawn', 'list', 'message', 'wait', 'stop', 'compact', 'yield', 'finish', 'verify', 'pipeline']),
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
  private readonly stopErrors = new Map<string, string>();
  readonly name = 'SessionControl' as const;
  readonly description = 'Spawn autonomous child sessions, list sessions and background processes, message a child, wait for output, stop work, or compact this conversation. Interactive conductors dispatch durable independent sessions and use snapshot-only waits; independent mutations require expectedRevision. Use session or task IDs returned by spawn/list/Bash. Spawn returns immediately; message steers a running child or resumes an idle child. Wait timeout is seconds; 0 reads current output without waiting.';
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
    const coordination = this.host?.coordination;
    const conductor = this.host?.role === 'interactive-conductor' || coordination !== undefined;
    if (args.operation === 'pipeline') {
      if (coordination === undefined || args.planId === undefined) return { isError: true, output: 'pipeline requires conductor coordination and trusted host planId.' };
      const accepted = await coordination.startPipeline(args.planId, args.idempotencyKey ?? context.toolCallId, this.host?.workerAncestry);
      return { output: JSON.stringify(coordination.fact(accepted.id)) };
    }
    if (args.operation === 'spawn' && (args.lane === 'independent' || conductor)) {
      if (coordination === undefined) return { isError: true, output: 'Independent dispatch requires an explicit conductor session with a coordinator.' };
      if (args.cwd === undefined) return { isError: true, output: 'Independent dispatch requires absolute cwd.' };
      const accepted = await coordination.dispatch({
        prompt: args.prompt!, description: args.description!, cwd: args.cwd, model: args.model,
        ownership: args.ownership, purpose: args.purpose, sourceRevision: args.sourceRevision, timeoutMs: args.timeout === undefined ? undefined : args.timeout * 1000,
      }, args.idempotencyKey ?? context.toolCallId, this.host?.workerAncestry);
      return { output: JSON.stringify(coordination.fact(accepted.id)) };
    }
    if (args.id?.startsWith('coord_') === true && ['message', 'wait', 'stop', 'yield', 'finish', 'verify', 'pipeline'].includes(args.operation)) {
      if (coordination === undefined) return { isError: true, output: 'Independent coordinator unavailable.' };
      if (args.operation === 'message') {
        await coordination.message(args.id, args.message!, args.idempotencyKey ?? context.toolCallId, args.expectedRevision);
        return { output: JSON.stringify(coordination.fact(args.id)) };
      }
      if (args.operation === 'verify') {
        if (args.planId === undefined || args.expectedRevision === undefined) return { isError: true, output: 'verify requires host planId and expectedRevision.' };
        await coordination.verify(args.id, args.planId, args.expectedRevision);
      } else if (args.operation === 'stop') {
        await coordination.stop(args.id, args.expectedRevision);
      } else if (args.operation === 'yield' || args.operation === 'finish') {
        if (args.expectedRevision === undefined) return { isError: true, output: 'Independent mutation requires expectedRevision.' };
        await coordination.park(args.id, args.operation === 'yield' ? 'yielded' : 'finished', args.expectedRevision);
      } else {
        if (conductor && (args.timeout ?? 0) > 0) return { isError: true, output: 'Conductor waits are snapshots only; use timeout=0.' };
        await coordination.wait(args.id, (args.timeout ?? 0) * 1000, context.signal);
      }
      return { output: JSON.stringify(coordination.fact(args.id)) };
    }
    switch (args.operation) {
      case 'list': {
        const tasks = this.manager.list(false);
        return { output: JSON.stringify({ tasks: conductor ? tasks.slice(-32).map((task) => ({ taskId: task.taskId, kind: task.kind, status: task.status, description: task.description.slice(0, 256), resourcesSettled: task.resourcesSettled })) : tasks, taskCount: tasks.length, sessions: conductor ? (this.host?.listActive() ?? []).slice(-32) : this.host?.listActive() ?? [], independentSessions: coordination?.facts() ?? { records: [], total: 0 }, stopErrors: [...this.stopErrors].slice(-32) }) };
      }
      case 'spawn':
        return this.launch(args.prompt!, args.description!, context, args);
      case 'message': {
        const task = this.taskFor(args.id!);
        const agentId = task?.kind === 'agent' ? task.agentId : args.id;
        if (agentId === undefined || this.host === undefined) return { isError: true, output: 'Child session host is unavailable.' };
        if (this.host.steerChild(agentId, [{ type: 'text', text: args.message! }])) {
          return { output: JSON.stringify({ agentId, delivered: true }) };
        }
        if (conductor) return { isError: true, output: 'Conductor cannot implicitly resume a coupled worker; select a reusable independent session.' };
        return this.launch(args.message!, `Message ${agentId}`, context, {}, agentId);
      }
      case 'wait': {
        const task = this.taskFor(args.id!);
        if (task === undefined) return { isError: true, output: `Session or task not found: ${args.id}` };
        if (conductor && (args.timeout ?? 0) > 0) return { isError: true, output: 'Conductor waits are snapshots only; use timeout=0.' };
        const timeout = args.timeout ?? (conductor ? 0 : 30);
        if (timeout > 0) {
          await this.manager.waitForActiveTasks((entry) => entry.taskId === task.taskId, { timeoutMs: timeout * 1000, signal: context.signal });
        }
        context.signal.throwIfAborted();
        const current = this.manager.getTask(task.taskId) ?? task;
        const output = await this.manager.getOutputSnapshot(task.taskId, conductor ? 4 * 1024 : 32 * 1024);
        return { output: JSON.stringify({ ...current, output }), isError: current.status !== 'running' && current.status !== 'completed' };
      }
      case 'stop': {
        const task = this.taskFor(args.id!);
        if (task !== undefined) {
          if (conductor) {
            this.observeStop(task.taskId, this.manager.stop(task.taskId, args.reason));
            return { output: JSON.stringify({ taskId: task.taskId, cancelRequested: true, resourcesSettled: false }) };
          }
          const stopped = await this.manager.stop(task.taskId, args.reason);
          if (stopped !== undefined) return { output: JSON.stringify(stopped) };
        }
        if (conductor && this.host?.listActive().some((entry) => entry.agentId === args.id) === true) {
          this.observeStop(args.id!, this.host.stopAndJoin(args.id!, args.reason));
          return { output: JSON.stringify({ agentId: args.id, cancelRequested: true, resourcesSettled: false }) };
        }
        if (await this.host?.stopAndJoin(args.id!, args.reason) === true) {
          return { output: JSON.stringify({ agentId: args.id, cancelRequested: true, resourcesSettled: true }) };
        }
        return { isError: true, output: `No live session or task found: ${args.id}` };
      }
      case 'verify':
      case 'yield':
      case 'finish':
        return { isError: true, output: 'yield/finish require an independent coordinator ID.' };
      case 'compact': {
        const before = this.agent.context.tokenCountWithPending;
        const compaction = this.agent.fullCompaction;
        if (conductor) {
          compaction.begin({ source: 'agent', instruction: args.instruction, summary: args.summary });
          return { output: JSON.stringify({ status: 'accepted', tokensBefore: before }) };
        }
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

  private observeStop(id: string, stop: Promise<unknown>): void {
    void stop.catch((error: unknown) => {
      this.stopErrors.set(id, String(error).slice(0, 1024));
      if (this.stopErrors.size > 32) this.stopErrors.delete(this.stopErrors.keys().next().value!);
    });
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
