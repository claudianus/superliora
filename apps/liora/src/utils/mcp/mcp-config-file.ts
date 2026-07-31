/**
 * Claude-compatible mcp.json mutate helpers for the TUI control plane.
 * Mirrors agent-core config-mutate scopes without importing agent-core.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

import { getDataDir } from '#/utils/paths';

export type McpConfigScope = 'user' | 'projectRoot' | 'project';

export type McpServerFileConfig = {
  readonly transport?: 'stdio' | 'http' | 'sse';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly bearerTokenEnvVar?: string;
  readonly enabled?: boolean;
  readonly startupTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly enabledTools?: readonly string[];
  readonly disabledTools?: readonly string[];
};

export interface McpJsonPaths {
  readonly user: string;
  readonly projectRoot: string;
  readonly project: string;
}

export async function resolveMcpJsonPaths(cwd: string, homeDir: string = getDataDir()): Promise<McpJsonPaths> {
  const projectRoot = await findProjectRoot(cwd);
  return {
    user: join(homeDir, 'mcp.json'),
    projectRoot: join(projectRoot, '.mcp.json'),
    project: join(cwd, '.superliora', 'mcp.json'),
  };
}

export async function readMcpJsonFile(filePath: string): Promise<Record<string, McpServerFileConfig>> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if (isEnoent(error)) return {};
    throw error;
  }
  if (text.trim().length === 0) return {};
  const data = JSON.parse(text) as { mcpServers?: Record<string, McpServerFileConfig> };
  return { ...data.mcpServers };
}

export async function writeMcpJsonFile(
  filePath: string,
  servers: Record<string, McpServerFileConfig>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`, 'utf-8');
}

export async function upsertMcpServer(
  cwd: string,
  scope: McpConfigScope,
  name: string,
  config: McpServerFileConfig,
  homeDir?: string,
): Promise<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('MCP server name must be non-empty');
  const path = await scopePath(cwd, scope, homeDir);
  const servers = await readMcpJsonFile(path);
  servers[trimmed] = normalizeConfig(config);
  await writeMcpJsonFile(path, servers);
  return path;
}

export async function setMcpServerEnabled(
  cwd: string,
  scope: McpConfigScope,
  name: string,
  enabled: boolean,
  homeDir?: string,
): Promise<{ path: string; found: boolean }> {
  const path = await scopePath(cwd, scope, homeDir);
  const servers = await readMcpJsonFile(path);
  const existing = servers[name];
  if (existing === undefined) return { path, found: false };
  servers[name] = { ...existing, enabled };
  await writeMcpJsonFile(path, servers);
  return { path, found: true };
}

export async function removeMcpServer(
  cwd: string,
  scope: McpConfigScope,
  name: string,
  homeDir?: string,
): Promise<{ path: string; found: boolean }> {
  const path = await scopePath(cwd, scope, homeDir);
  const servers = await readMcpJsonFile(path);
  if (servers[name] === undefined) return { path, found: false };
  delete servers[name];
  await writeMcpJsonFile(path, servers);
  return { path, found: true };
}

/** Find which scope currently defines `name` (project wins over projectRoot over user). */
export async function findMcpServerScope(
  cwd: string,
  name: string,
  homeDir?: string,
): Promise<McpConfigScope | undefined> {
  const paths = await resolveMcpJsonPaths(cwd, homeDir ?? getDataDir());
  const order: readonly McpConfigScope[] = ['project', 'projectRoot', 'user'];
  for (const scope of order) {
    const servers = await readMcpJsonFile(pathForScope(paths, scope));
    if (servers[name] !== undefined) return scope;
  }
  return undefined;
}

export function stdioConfig(command: string, args: readonly string[] = []): McpServerFileConfig {
  return { transport: 'stdio', command, args: [...args], enabled: true };
}

export function httpConfig(url: string): McpServerFileConfig {
  return { transport: 'http', url, enabled: true };
}

function normalizeConfig(config: McpServerFileConfig): McpServerFileConfig {
  if (config.transport !== undefined) return config;
  if (typeof config.command === 'string') return { ...config, transport: 'stdio' };
  if (typeof config.url === 'string') return { ...config, transport: 'http' };
  return config;
}

async function scopePath(cwd: string, scope: McpConfigScope, homeDir?: string): Promise<string> {
  const paths = await resolveMcpJsonPaths(cwd, homeDir ?? getDataDir());
  return pathForScope(paths, scope);
}

function pathForScope(paths: McpJsonPaths, scope: McpConfigScope): string {
  switch (scope) {
    case 'user':
      return paths.user;
    case 'projectRoot':
      return paths.projectRoot;
    case 'project':
      return paths.project;
  }
}

async function findProjectRoot(cwd: string): Promise<string> {
  const start = normalize(cwd);
  let current = start;
  while (true) {
    try {
      await stat(join(current, '.git'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return start;
      current = parent;
    }
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}
