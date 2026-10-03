import { RequestError, type McpServer } from '@agentclientprotocol/sdk';

/** ACP requires the list on session requests; only the empty list is supported. */
export function rejectUnsupportedMcpServers(servers: readonly McpServer[] | undefined): void {
  if (servers !== undefined && servers.length > 0) {
    throw RequestError.invalidParams(
      { servers: servers.map((server) => server.name) },
      'MCP servers are not supported; this agent exposes only Bash and SessionControl.',
    );
  }
}
