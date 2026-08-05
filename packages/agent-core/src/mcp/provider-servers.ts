/**
 * Auto-injected provider MCP servers.
 *
 * Some subscriptions ship dedicated MCP servers alongside the models (Z.AI
 * GLM Coding Plan: web search, web reader, zread, vision). When the matching
 * credential is detected, these servers are merged into the session MCP
 * config at the lowest precedence — any user-declared server with the same
 * name (from mcp.json files or caller config) overrides the injected one.
 *
 * Opt out: `[mcp] autoProviderServers = false` in config.toml, or
 * `SUPERLIORA_NO_PROVIDER_MCP=1` in the environment. A single service can be
 * disabled via `[extras] disabledProviders = ["zai"]`.
 */

import type { LioraConfig, McpServerConfig } from '#/config/schema';
import { detectProviderExtras } from '#/tools/providers/extras/index';

export const PROVIDER_MCP_AUTO_DISABLE_ENV = 'SUPERLIORA_NO_PROVIDER_MCP';

const ZAI_MCP_BASE = 'https://api.z.ai/api/mcp';

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

export function resolveProviderMcpServers(
  config: Pick<LioraConfig, 'providers'> & Partial<Pick<LioraConfig, 'mcp' | 'extras'>>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerConfig> {
  if (truthy(env[PROVIDER_MCP_AUTO_DISABLE_ENV])) return {};
  if (config.mcp?.autoProviderServers === false) return {};

  const servers: Record<string, McpServerConfig> = {};
  for (const detected of detectProviderExtras(config, env)) {
    if (detected.declaration.id === 'zai' && detected.apiKey !== undefined) {
      Object.assign(servers, zaiMcpServers(detected.apiKey, detected.apiKeyEnv));
    }
  }
  return servers;
}

/**
 * Z.AI GLM Coding Plan bundle (docs.z.ai/devpack): remote streamable-HTTP
 * servers take Bearer auth; vision is a local stdio server that reads the
 * key from its own env.
 */
function zaiMcpServers(apiKey: string, apiKeyEnv?: string): Record<string, McpServerConfig> {
  const auth: Pick<McpServerConfig & { transport: 'http' }, 'headers' | 'bearerTokenEnvVar'> =
    apiKeyEnv !== undefined
      ? { bearerTokenEnvVar: apiKeyEnv }
      : { headers: { Authorization: `Bearer ${apiKey}` } };
  return {
    'zai-web-search': { transport: 'http', url: `${ZAI_MCP_BASE}/web_search_prime/mcp`, ...auth },
    'zai-web-reader': { transport: 'http', url: `${ZAI_MCP_BASE}/web_reader/mcp`, ...auth },
    'zai-zread': { transport: 'http', url: `${ZAI_MCP_BASE}/zread/mcp`, ...auth },
    'zai-vision': {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@z_ai/mcp-server'],
      env: { Z_AI_API_KEY: apiKey, Z_AI_MODE: 'ZAI' },
    },
  };
}
