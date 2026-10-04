import { runtimePathPrefixDirs } from '@superliora/kaos';

import type { Agent } from '..';
import type { BashInput } from '../../tools/builtin/shell/bash';
import { BashTool, SessionControlTool } from '../../tools/builtin';
import type { ExecutableToolResult, ToolExecution } from '../../loop/types';
import type { BuiltinTool } from './types';

/** Recent tool-call ids kept for turn-replay dedupe; older ids are evicted. */
const ACCEPTED_IDENTITY_LIMIT = 128;

/** User `!` commands: the host already owns these, so they keep foreground streaming. */
const hostShellInputs = new WeakSet<BashInput>();

export function hostShellInput(args: BashInput): BashInput {
  hostShellInputs.add(args);
  return args;
}

class ConductorBashTool extends BashTool {
  private readonly accepted = new Map<string, { identity: string; result: Promise<ExecutableToolResult> }>();

  override resolveExecution(args: BashInput): ToolExecution {
    if (hostShellInputs.has(args)) return super.resolveExecution(args);
    const normalized = { ...args, run_in_background: true, description: args.description ?? 'Conductor command' };
    const execution = super.resolveExecution(normalized);
    if (!('execute' in execution)) return execution;
    const identity = JSON.stringify(normalized);
    return { ...execution, execute: async (context) => {
      context.signal.throwIfAborted();
      const prior = this.accepted.get(context.toolCallId);
      if (prior !== undefined) return prior.identity === identity ? prior.result : { isError: true, output: 'Conductor command identity conflict.' };
      if (this.accepted.size >= ACCEPTED_IDENTITY_LIMIT) this.accepted.delete(this.accepted.keys().next().value!);
      const result = Promise.resolve(execution.execute(context));
      this.accepted.set(context.toolCallId, { identity, result });
      return result;
    } };
  }
}

export function buildBuiltinTools(host: { readonly agent: Agent }): Map<string, BuiltinTool> {
  const agent = host.agent;
  const Bash = agent.role === 'interactive-conductor' ? ConductorBashTool : BashTool;
  const bash = new Bash(agent.kaos, agent.config.cwd, agent.background, {
    backgroundAdmission: agent.role === 'interactive-conductor' ? 'before-start' : 'after-start',
    ensureSandboxReady: () => agent.ensureSandboxReady(),
    pathPrefix: runtimePathPrefixDirs(),
    workspace: {
      workspaceDir: agent.config.cwd,
      additionalDirs: agent.getAdditionalDirs(),
      sandboxProfile: agent.sandboxProfile,
    },
  });
  const sessions = new SessionControlTool(agent, agent.background, agent.sessionControl);
  return new Map<string, BuiltinTool>([[bash.name, bash], [sessions.name, sessions]]);
}
