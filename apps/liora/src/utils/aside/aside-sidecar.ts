/**
 * Opt-in Aside MCP sidecar helpers.
 *
 * Aside is not a BrowserUseProvider. Operators wire the official `aside mcp`
 * stdio server into ~/.superliora/mcp.json; Builtin Browser* stay on Cloak.
 */

import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import {
  readMcpJsonFile,
  removeMcpServer,
  resolveMcpJsonPaths,
  stdioConfig,
  upsertMcpServer,
  type McpServerFileConfig,
} from '#/utils/mcp/mcp-config-file';
import { getDataDir } from '#/utils/paths';

export const ASIDE_MCP_SERVER_NAME = 'aside';
export const ASIDE_INSTALL_URL = 'https://releases.aside.com/install.sh';
export const ASIDE_INSTALL_HINT = `curl -fsSL ${ASIDE_INSTALL_URL} | bash`;

export type AsidePathExists = (filePath: string) => boolean;

export interface ResolveAsideCliPathOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly pathExists?: AsidePathExists | undefined;
  /** Override OS home for known install locations (tests). */
  readonly homeDir?: string | undefined;
}

export interface AsideSidecarStatus {
  readonly cliPath: string | undefined;
  readonly mcpRegistered: boolean;
  readonly mcpEnabled: boolean;
  readonly mcpCommand: string | undefined;
  readonly mcpJsonPath: string;
  readonly ready: boolean;
}

export interface AsideSidecarContext {
  readonly cwd: string;
  readonly dataDir?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly pathExists?: AsidePathExists | undefined;
  readonly homeDir?: string | undefined;
}

function defaultPathExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    try {
      accessSync(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function trimEnvPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function lookupOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  pathExists: AsidePathExists,
): string | undefined {
  const pathEnv = env['PATH'] ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, name);
    if (pathExists(candidate)) return candidate;
    if (process.platform === 'win32') {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        const withExt = `${candidate}${ext}`;
        if (pathExists(withExt)) return withExt;
      }
    }
  }
  return undefined;
}

function knownAsideCandidates(osHome: string): readonly string[] {
  return [
    join(osHome, '.local', 'bin', 'aside'),
    join(osHome, '.aside', 'bin', 'aside'),
  ];
}

/** Resolve the Aside CLI absolute path, or undefined if not found. */
export function resolveAsideCliPath(options: ResolveAsideCliPathOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? defaultPathExists;
  const osHome = options.homeDir ?? homedir();

  for (const key of ['ASIDE_CLI', 'ASIDE_EXECUTABLE_PATH'] as const) {
    const fromEnv = trimEnvPath(env[key]);
    if (fromEnv !== undefined && pathExists(fromEnv)) return fromEnv;
  }

  const onPath = lookupOnPath('aside', env, pathExists);
  if (onPath !== undefined) return onPath;

  for (const candidate of knownAsideCandidates(osHome)) {
    if (pathExists(candidate)) return candidate;
  }
  return undefined;
}

export function buildAsideMcpServerConfig(command: string): McpServerFileConfig {
  return stdioConfig(command, ['mcp']);
}

export async function loadAsideSidecarStatus(
  ctx: AsideSidecarContext,
): Promise<AsideSidecarStatus> {
  const dataDir = ctx.dataDir ?? getDataDir();
  const paths = await resolveMcpJsonPaths(ctx.cwd, dataDir);
  const servers = await readMcpJsonFile(paths.user);
  const entry = servers[ASIDE_MCP_SERVER_NAME];
  const mcpRegistered = entry !== undefined;
  const mcpEnabled = mcpRegistered && entry.enabled !== false;
  const mcpCommand =
    entry !== undefined && typeof entry.command === 'string' ? entry.command : undefined;
  const cliPath = resolveAsideCliPath({
    env: ctx.env,
    pathExists: ctx.pathExists,
    homeDir: ctx.homeDir,
  });
  return {
    cliPath,
    mcpRegistered,
    mcpEnabled,
    mcpCommand,
    mcpJsonPath: paths.user,
    ready: cliPath !== undefined && mcpEnabled,
  };
}

export function formatAsideSidecarStatus(status: AsideSidecarStatus): string {
  const lines = ['Aside MCP sidecar (optional):'];
  if (status.cliPath !== undefined) {
    lines.push(`  CLI: ${status.cliPath}`);
  } else {
    lines.push('  CLI: not found');
    lines.push(`  Install: ${ASIDE_INSTALL_HINT}`);
  }

  if (status.mcpEnabled) {
    const cmd = status.mcpCommand ?? '(missing command)';
    lines.push(`  MCP: enabled in ${status.mcpJsonPath} (${cmd} mcp)`);
  } else if (status.mcpRegistered) {
    lines.push(`  MCP: registered but disabled in ${status.mcpJsonPath}`);
    lines.push('  Enable: liora browser-use aside enable');
  } else {
    lines.push(`  MCP: not registered in ${status.mcpJsonPath}`);
    lines.push('  Enable: liora browser-use aside enable');
  }

  lines.push(`  Ready: ${status.ready ? 'yes' : 'no'}`);
  return `${lines.join('\n')}\n`;
}

export async function enableAsideSidecar(
  ctx: AsideSidecarContext,
): Promise<{ readonly path: string; readonly command: string }> {
  const cliPath = resolveAsideCliPath({
    env: ctx.env,
    pathExists: ctx.pathExists,
    homeDir: ctx.homeDir,
  });
  if (cliPath === undefined) {
    throw new AsideCliMissingError();
  }
  const path = await upsertMcpServer(
    ctx.cwd,
    'user',
    ASIDE_MCP_SERVER_NAME,
    buildAsideMcpServerConfig(cliPath),
    ctx.dataDir ?? getDataDir(),
  );
  return { path, command: cliPath };
}

export async function disableAsideSidecar(
  ctx: AsideSidecarContext,
): Promise<{ readonly path: string; readonly found: boolean }> {
  return removeMcpServer(
    ctx.cwd,
    'user',
    ASIDE_MCP_SERVER_NAME,
    ctx.dataDir ?? getDataDir(),
  );
}

export class AsideCliMissingError extends Error {
  override readonly name = 'AsideCliMissingError';

  constructor() {
    super(
      `Aside CLI not found. Install with: ${ASIDE_INSTALL_HINT} (or set ASIDE_CLI to the absolute path)`,
    );
  }
}
