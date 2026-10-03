import { runtimePathPrefixDirs } from '@superliora/kaos';

import type { Agent } from '..';
import { BashTool, SessionControlTool } from '../../tools/builtin';
import type { BuiltinTool } from './types';

export function buildBuiltinTools(host: { readonly agent: Agent }): Map<string, BuiltinTool> {
  const agent = host.agent;
  const bash = new BashTool(agent.kaos, agent.config.cwd, agent.background, {
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
