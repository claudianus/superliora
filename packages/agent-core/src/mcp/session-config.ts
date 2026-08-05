import type { LioraConfig, McpServerConfig } from '#/config/schema';

import { loadMcpServers } from './config-loader';
import { resolveProviderMcpServers } from './provider-servers';

export interface SessionMcpConfig {
  readonly servers: Record<string, McpServerConfig>;
}

export interface ResolveSessionMcpConfigInput {
  readonly cwd: string;
  readonly homeDir?: string;
  /**
   * Loaded Liora config. When provided, provider-bundled MCP servers (Z.AI
   * coding plan, …) are auto-injected at the lowest precedence; user mcp.json
   * entries with the same name always win.
   */
  readonly config?: Pick<LioraConfig, 'providers'> & Partial<Pick<LioraConfig, 'mcp' | 'extras'>>;
}

export async function resolveSessionMcpConfig(
  input: ResolveSessionMcpConfigInput,
): Promise<SessionMcpConfig | undefined> {
  const auto = input.config === undefined ? {} : resolveProviderMcpServers(input.config);
  const fileServers = await loadMcpServers({
    cwd: input.cwd,
    homeDir: input.homeDir,
  });
  const servers = { ...auto, ...fileServers };
  if (Object.keys(servers).length === 0) return undefined;
  return { servers };
}

export function mergeCallerMcpServers(
  base: SessionMcpConfig | undefined,
  callerServers: Readonly<Record<string, McpServerConfig>> | undefined,
): SessionMcpConfig | undefined {
  if (callerServers === undefined || Object.keys(callerServers).length === 0) {
    return base;
  }
  return {
    servers: {
      ...base?.servers,
      ...callerServers,
    },
  };
}
