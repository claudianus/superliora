import type { Tool } from '@superliora/kosong';

import { makeErrorPayload } from '../../errors';
import type { ExecutableTool } from '../../loop';
import { createMcpAuthTool } from '../../mcp/auth-tool';
import type { McpConnectionManager, McpServerEntry } from '../../mcp';
import { mcpResultToExecutableOutput } from '../../mcp/output';
import { qualifyMcpToolName } from '../../mcp/tool-naming';
import type { MCPClient } from '../../mcp/types';
import type { McpServerRegistrationResult, McpToolCollision } from './types';
import type { Agent } from '..';

export interface McpToolEntry {
  readonly tool: ExecutableTool;
  readonly serverName: string;
}

export interface McpToolsHost {
  readonly agent: Agent;
  readonly mcpTools: Map<string, McpToolEntry>;
  readonly mcpToolsByServer: Map<string, string[]>;
}

export function attachMcpTools(
  host: McpToolsHost,
  mcp: McpConnectionManager,
  onFirstAttach: (unsubscribe: () => void) => void,
  alreadySubscribed: boolean,
): void {
  if (alreadySubscribed) return;
  for (const entry of mcp.list()) {
    if (entry.status === 'connected') {
      registerConnectedMcpServer(host, mcp, entry);
    } else if (entry.status === 'needs-auth') {
      registerNeedsAuthMcpServer(host, mcp, entry);
    }
  }
  onFirstAttach(
    mcp.onStatusChange((entry) => {
      handleMcpServerStatusChange(host, mcp, entry);
    }),
  );
}

export function registerMcpServer(
  host: McpToolsHost,
  serverName: string,
  client: MCPClient,
  tools: readonly Tool[],
  enabledTools?: ReadonlySet<string>,
): McpServerRegistrationResult {
  unregisterMcpServer(host, serverName);
  const qualifiedNames: string[] = [];
  const collisions: McpToolCollision[] = [];
  const seenInThisCall = new Map<string, string>();
  for (const tool of tools) {
    if (enabledTools !== undefined && !enabledTools.has(tool.name)) continue;
    const qualified = qualifyMcpToolName(serverName, tool.name);
    const firstInThisCall = seenInThisCall.get(qualified);
    if (firstInThisCall !== undefined) {
      collisions.push({
        qualified,
        toolName: tool.name,
        collidesWith: { kind: 'same_server', toolName: firstInThisCall },
      });
      continue;
    }
    const existingEntry = host.mcpTools.get(qualified);
    if (existingEntry !== undefined) {
      collisions.push({
        qualified,
        toolName: tool.name,
        collidesWith: { kind: 'other_server', serverName: existingEntry.serverName },
      });
      continue;
    }
    seenInThisCall.set(qualified, tool.name);
    const wrapped: ExecutableTool = {
      name: qualified,
      description: tool.description,
      parameters: tool.parameters,
      resolveExecution: (args) => {
        return {
          approvalRule: qualified,
          execute: async (context) => {
            // `args` has already been JSON-parsed and schema-validated by
            // the loop's preflight (`loop/tool-call.ts`), so the MCP
            // client gets a plain object directly.
            const result = await client.callTool(
              tool.name,
              (args ?? {}) as Record<string, unknown>,
              context.signal,
            );
            return mcpResultToExecutableOutput(result, qualified);
          },
        };
      },
    };
    host.mcpTools.set(qualified, { tool: wrapped, serverName });
    qualifiedNames.push(qualified);
  }
  host.mcpToolsByServer.set(serverName, qualifiedNames);
  injectMcpServerInstructions(host, serverName, client);
  return { registered: qualifiedNames, collisions };
}

/**
 * Surface server-level usage instructions (from the MCP `initialize`
 * handshake) into the agent context so the model learns how to use the
 * server's tools without a per-turn prompt cost. Compliant servers
 * (Claude Code, Cursor, opencode, ...) emit these at connection time.
 */
function injectMcpServerInstructions(
  host: McpToolsHost,
  serverName: string,
  client: MCPClient,
): void {
  const instructions = client.getInstructions?.();
  if (instructions === undefined || instructions.trim().length === 0) return;
  host.agent.context?.appendSystemReminder(
    `MCP server "${serverName}" usage instructions:\n${instructions.trim()}`,
    { kind: 'injection', variant: 'mcp_instructions' },
  );
}

export function unregisterMcpServer(host: McpToolsHost, serverName: string): boolean {
  const existing = host.mcpToolsByServer.get(serverName);
  if (existing === undefined) return false;
  for (const qualified of existing) {
    host.mcpTools.delete(qualified);
  }
  host.mcpToolsByServer.delete(serverName);
  return true;
}

export function handleMcpServerStatusChange(
  host: McpToolsHost,
  mcp: McpConnectionManager,
  entry: McpServerEntry,
): void {
  if (entry.status === 'connected') {
    registerConnectedMcpServer(host, mcp, entry);
    return;
  }
  if (entry.status === 'needs-auth') {
    registerNeedsAuthMcpServer(host, mcp, entry);
    return;
  }
  if (entry.status === 'failed') {
    unregisterMcpServer(host, entry.name);
    host.agent.emitEvent({
      type: 'tool.list.updated',
      reason: 'mcp.failed',
      serverName: entry.name,
    });
    return;
  }
  if (entry.status === 'disabled' || entry.status === 'pending') {
    const removed = unregisterMcpServer(host, entry.name);
    if (removed) {
      host.agent.emitEvent({
        type: 'tool.list.updated',
        reason: 'mcp.disconnected',
        serverName: entry.name,
      });
    }
  }
}

export function registerNeedsAuthMcpServer(
  host: McpToolsHost,
  mcp: McpConnectionManager,
  entry: McpServerEntry,
): void {
  // Replace whatever tools (real or synthetic) were registered before; a
  // server flipping to needs-auth means previous tokens were invalidated.
  unregisterMcpServer(host, entry.name);
  const oauthService = mcp.oauthService;
  const serverUrl = mcp.getRemoteServerUrl(entry.name);
  if (oauthService === undefined || serverUrl === undefined) {
    // Misconfiguration: a server reached needs-auth without the manager
    // owning an OAuth service or being remote. Treat it as a no-op so the
    // existing failure error message keeps the user informed.
    return;
  }
  const tool = createMcpAuthTool({
    serverName: entry.name,
    serverUrl,
    oauthService,
    reconnect: async () => {
      await mcp.reconnect(entry.name);
    },
  });
  host.mcpTools.set(tool.name, { tool, serverName: entry.name });
  host.mcpToolsByServer.set(entry.name, [tool.name]);
  // The synthetic auth tool is now in the tool list; surface it the same way
  // a real toolset would show up so the model picks it up.
  host.agent.emitEvent({
    type: 'tool.list.updated',
    reason: 'mcp.connected',
    serverName: entry.name,
  });
}

function registerConnectedMcpServer(
  host: McpToolsHost,
  mcp: McpConnectionManager,
  entry: McpServerEntry,
): void {
  const resolved = mcp.resolved(entry.name);
  if (resolved === undefined) return;
  const result = registerMcpServer(
    host,
    entry.name,
    resolved.client,
    resolved.tools,
    resolved.enabledNames,
  );
  emitMcpToolCollisions(host, entry.name, result.collisions);
  host.agent.emitEvent({
    type: 'tool.list.updated',
    reason: 'mcp.connected',
    serverName: entry.name,
  });
}

function emitMcpToolCollisions(
  host: McpToolsHost,
  serverName: string,
  collisions: readonly McpToolCollision[],
): void {
  if (collisions.length === 0) return;
  const summary = collisions
    .map((c) =>
      c.collidesWith.kind === 'same_server'
        ? `"${c.toolName}" -> ${c.qualified} (collides with "${c.collidesWith.toolName}" from the same server)`
        : `"${c.toolName}" -> ${c.qualified} (collides with server "${c.collidesWith.serverName}")`,
    )
    .join('; ');
  host.agent.emitEvent({
    type: 'error',
    ...makeErrorPayload(
      'mcp.tool_name_collision',
      `MCP server "${serverName}" registered ${collisions.length} tool name` +
        `${collisions.length === 1 ? '' : 's'} ` +
        `that collide with existing qualified names; the losing tools were dropped: ${summary}`,
      { details: { serverName, collisions: collisions as readonly unknown[] } },
    ),
  });
}
