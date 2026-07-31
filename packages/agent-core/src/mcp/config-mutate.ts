/**
 * Read/write helpers for Claude-compatible mcp.json files.
 * Scopes: user (~/.superliora/mcp.json), projectRoot (.mcp.json), project (.superliora/mcp.json).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'pathe';

import type { McpServerConfig } from '#/config/schema';
import { McpServerConfigSchema } from '#/config/schema';
import { ErrorCodes, LioraError } from '#/errors/index';
import { z } from 'zod';

import { resolveMcpJsonPaths, type McpJsonPaths } from './config-loader';

const McpJsonFileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).default({}),
});

export type McpConfigScope = 'user' | 'projectRoot' | 'project';

export interface McpMutateContext {
  readonly cwd: string;
  readonly homeDir?: string;
}

export async function resolveMcpScopePath(
  ctx: McpMutateContext,
  scope: McpConfigScope,
): Promise<string> {
  const paths = await resolveMcpJsonPaths({ cwd: ctx.cwd, homeDir: ctx.homeDir });
  return pathForScope(paths, scope);
}

export async function readMcpJsonFile(filePath: string): Promise<Record<string, McpServerConfig>> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if (isFileNotFound(error)) return {};
    throw new LioraError(
      ErrorCodes.CONFIG_INVALID,
      `Failed to read ${filePath}: ${describeError(error)}`,
      { cause: error },
    );
  }
  if (text.trim().length === 0) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error: unknown) {
    throw new LioraError(
      ErrorCodes.CONFIG_INVALID,
      `Invalid JSON in ${filePath}: ${describeError(error)}`,
      { cause: error },
    );
  }
  const parsed = McpJsonFileSchema.parse(data);
  const out: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(parsed.mcpServers)) {
    out[name] = McpServerConfigSchema.parse(raw);
  }
  return out;
}

export async function writeMcpJsonFile(
  filePath: string,
  servers: Record<string, McpServerConfig>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const body = `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
  await writeFile(filePath, body, 'utf-8');
}

export async function upsertMcpServerInScope(
  ctx: McpMutateContext,
  scope: McpConfigScope,
  name: string,
  config: McpServerConfig,
): Promise<{ readonly path: string }> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, 'MCP server name must be non-empty');
  }
  const parsed = McpServerConfigSchema.parse(config);
  const path = await resolveMcpScopePath(ctx, scope);
  const servers = await readMcpJsonFile(path);
  servers[trimmed] = parsed;
  await writeMcpJsonFile(path, servers);
  return { path };
}

export async function setMcpServerEnabledInScope(
  ctx: McpMutateContext,
  scope: McpConfigScope,
  name: string,
  enabled: boolean,
): Promise<{ readonly path: string; readonly found: boolean }> {
  const path = await resolveMcpScopePath(ctx, scope);
  const servers = await readMcpJsonFile(path);
  const existing = servers[name];
  if (existing === undefined) return { path, found: false };
  servers[name] = { ...existing, enabled };
  await writeMcpJsonFile(path, servers);
  return { path, found: true };
}

export async function removeMcpServerInScope(
  ctx: McpMutateContext,
  scope: McpConfigScope,
  name: string,
): Promise<{ readonly path: string; readonly found: boolean }> {
  const path = await resolveMcpScopePath(ctx, scope);
  const servers = await readMcpJsonFile(path);
  if (servers[name] === undefined) return { path, found: false };
  delete servers[name];
  await writeMcpJsonFile(path, servers);
  return { path, found: true };
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

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
