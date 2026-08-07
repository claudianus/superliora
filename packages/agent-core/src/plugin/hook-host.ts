import { createUserMessage } from '@superliora/kosong';

import type { Session } from '../session';
import type { HookHostServices } from '../session/hooks';
import { extractTextFromGenerateResponse } from '../utils/llm-classifier-utils';
import { pluginMcpRuntimeName } from './types';

const PROMPT_HOOK_SYSTEM = [
  'You evaluate a Claude-style session hook.',
  'Reply briefly.',
  'To deny, return JSON:',
  '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"..."}}',
  'Otherwise allow with a short plain-text note.',
].join(' ');

/** Build HookEngine hosts that call session MCP / main-agent side LLM. */
export function createSessionHookHost(session: Session): HookHostServices {
  return {
    callMcpTool: async (server, tool, args, signal) => {
      await session.mcp.waitForInitialLoad(signal);
      const names = mcpServerLookupNames(server, session.mcp.list().map((entry) => entry.name));
      for (const name of names) {
        const resolved = session.mcp.resolved(name);
        if (resolved !== undefined) {
          return resolved.client.callTool(tool, args, signal);
        }
      }
      throw new Error(`MCP server "${server}" is not connected`);
    },
    runPrompt: async (prompt, input, signal) => {
      const agent = session.getReadyAgent('main');
      if (agent === undefined) {
        throw new Error('main agent is not ready for prompt hooks');
      }
      if (!agent.config.hasProvider) {
        throw new Error('provider not configured for prompt hooks');
      }
      const response = await agent.generate(
        agent.config.provider,
        PROMPT_HOOK_SYSTEM,
        [],
        [
          createUserMessage(
            `${prompt.trim()}\n\nHook input:\n${JSON.stringify(input, null, 2)}`,
          ),
        ],
        undefined,
        { signal },
      );
      return extractTextFromGenerateResponse(response);
    },
  };
}

function mcpServerLookupNames(
  requested: string,
  connected: readonly string[],
): readonly string[] {
  const trimmed = requested.trim();
  if (trimmed.length === 0) return [];
  const out: string[] = [];
  const push = (name: string): void => {
    if (!out.includes(name)) out.push(name);
  };
  push(trimmed);
  if (trimmed.startsWith('plugin:')) {
    return out.filter((name) => connected.includes(name) || name === trimmed);
  }
  // Bare server name → try plugin:<id>:<server> matches.
  for (const name of connected) {
    if (name === trimmed || name.endsWith(`:${trimmed}`)) push(name);
  }
  // Prefer explicit runtime name if caller passed pluginId:server without prefix.
  if (trimmed.includes(':') && !trimmed.startsWith('plugin:')) {
    const [pluginId, server] = trimmed.split(':', 2);
    if (pluginId !== undefined && server !== undefined) {
      push(pluginMcpRuntimeName(pluginId, server));
    }
  }
  return out;
}
