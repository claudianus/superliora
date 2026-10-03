import { runtimePathPrefixDirs } from '@superliora/kaos';

import type { Agent } from '..';
import type { BashInput } from '../../tools/builtin/shell/bash';
import { BashTool, SessionControlTool } from '../../tools/builtin';
import type { ExecutableToolResult, ToolExecution } from '../../loop/types';
import type { BuiltinTool } from './types';

class ConductorBashTool extends BashTool {
  private readonly accepted = new Map<string, { identity: string; result: Promise<ExecutableToolResult> }>();

  override resolveExecution(args: BashInput): ToolExecution {
    const normalized = { ...args, run_in_background: true, description: args.description ?? 'Conductor command' };
    const execution = super.resolveExecution(normalized);
    if (!('execute' in execution)) return execution;
    const identity = JSON.stringify(normalized);
    return { ...execution, execute: async (context) => {
      context.signal.throwIfAborted();
      const prior = this.accepted.get(context.toolCallId);
      if (prior !== undefined) return prior.identity === identity ? prior.result : { isError: true, output: 'Conductor command identity conflict.' };
      if (this.accepted.size >= 128) return { isError: true, output: 'Conductor command identity quota reached.' };
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
