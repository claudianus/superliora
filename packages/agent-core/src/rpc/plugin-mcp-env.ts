/**
 * Plugin MCP server merging — extracted from core-impl.ts.
 *
 * Pure functions for folding plugin-provided MCP servers into a session's
 * MCP config, plus injecting the managed SuperLiora provider environment
 * (base URL / OAuth host) into plugin-declared stdio servers so they can
 * reach the same backend as the host session without separate credentials.
 */

import { SUPERLIORA_PROVIDER_NAME } from '@superliora/oauth';

import type { LioraConfig, McpServerConfig } from '../config';
import type { SessionMcpConfig } from '../mcp';

const SUPERLIORA_BASE_URL_ENV = 'SUPERLIORA_BASE_URL';
const SUPERLIORA_OAUTH_HOST_ENV = 'SUPERLIORA_OAUTH_HOST';
const KIMI_OAUTH_HOST_ENV = 'KIMI_OAUTH_HOST';

export function combinePluginMcpConfig(
  base: SessionMcpConfig | undefined,
  pluginServers: Record<string, McpServerConfig>,
): SessionMcpConfig | undefined {
  if (Object.keys(pluginServers).length === 0) return base;
  return {
    servers: {
      ...base?.servers,
      ...pluginServers,
    },
  };
}

export function withManagedKimiPluginEnv(
  pluginServers: Record<string, McpServerConfig>,
  managedEnv: Record<string, string>,
): Record<string, McpServerConfig> {
  if (Object.keys(managedEnv).length === 0) return pluginServers;

  const out: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(pluginServers)) {
    out[name] =
      server.transport === 'stdio' ? { ...server, env: { ...server.env, ...managedEnv } } : server;
  }
  return out;
}

export function managedKimiCodeEnvForPlugins(config: LioraConfig): Record<string, string> {
  const provider = config.providers[SUPERLIORA_PROVIDER_NAME];
  const envBaseUrl = process.env[SUPERLIORA_BASE_URL_ENV];
  const envOAuthHost = process.env[SUPERLIORA_OAUTH_HOST_ENV] ?? process.env[KIMI_OAUTH_HOST_ENV];
  const hasEnvOverride = envBaseUrl !== undefined || envOAuthHost !== undefined;
  const baseUrl = envBaseUrl !== undefined ? envBaseUrl.replace(/\/+$/, '') : provider?.baseUrl;
  const oauthHost = hasEnvOverride ? envOAuthHost : provider?.oauth?.oauthHost;
  const env: Record<string, string> = {};
  if (baseUrl !== undefined) env[SUPERLIORA_BASE_URL_ENV] = baseUrl;
  if (oauthHost !== undefined) env[SUPERLIORA_OAUTH_HOST_ENV] = oauthHost;
  return env;
}
