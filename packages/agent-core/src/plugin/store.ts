import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  PluginCapabilityState,
  PluginGithubMetadata,
  PluginScope,
  PluginSource,
} from './types';

const INSTALLED_REL = path.join('plugins', 'installed.json');

export interface InstalledRecord {
  readonly id: string;
  readonly root: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly updatedAt?: string;
  readonly originalSource?: string;
  readonly capabilities?: PluginCapabilityState;
  readonly github?: PluginGithubMetadata;
  /** Omitted in older files → treated as `user`. */
  readonly scope?: PluginScope;
}

export interface InstalledFile {
  readonly version: 2;
  readonly plugins: readonly InstalledRecord[];
}

const EMPTY: InstalledFile = { version: 2, plugins: [] };

export function userPluginsDir(kimiHomeDir: string): string {
  return path.join(kimiHomeDir, 'plugins');
}

export function projectPluginsDir(projectDir: string): string {
  return path.join(projectDir, '.superliora', 'plugins');
}

export function installedJsonPath(pluginsDir: string): string {
  return path.join(pluginsDir, 'installed.json');
}

/** Gitignored-style local overlay (Claude `local` scope analogue). */
export function localInstalledJsonPath(projectDir: string): string {
  return path.join(projectPluginsDir(projectDir), 'installed.local.json');
}

export async function readInstalled(kimiHomeDir: string): Promise<InstalledFile> {
  return readInstalledFile(installedJsonPath(userPluginsDir(kimiHomeDir)));
}

export async function readProjectInstalled(projectDir: string): Promise<InstalledFile> {
  return readInstalledFile(installedJsonPath(projectPluginsDir(projectDir)));
}

export async function readLocalInstalled(projectDir: string): Promise<InstalledFile> {
  return readInstalledFile(localInstalledJsonPath(projectDir));
}

export async function writeInstalled(kimiHomeDir: string, data: InstalledFile): Promise<void> {
  await writeInstalledFile(userPluginsDir(kimiHomeDir), data);
}

export async function writeProjectInstalled(
  projectDir: string,
  data: InstalledFile,
): Promise<void> {
  await writeInstalledFile(projectPluginsDir(projectDir), data);
}

export async function writeLocalInstalled(projectDir: string, data: InstalledFile): Promise<void> {
  await writeInstalledFile(projectPluginsDir(projectDir), data, 'installed.local.json');
}

async function readInstalledFile(filePath: string): Promise<InstalledFile> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as { version?: number; plugins?: unknown };
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.plugins)) {
      throw new Error('installed.json is not a valid InstalledFile object');
    }
    // v1 Kimi installs are not migrated — start empty so users reinstall Claude plugins.
    if (parsed.version !== 2) {
      return EMPTY;
    }
    return { version: 2, plugins: parsed.plugins as InstalledRecord[] };
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function writeInstalledFile(
  pluginsDir: string,
  data: InstalledFile,
  fileName = 'installed.json',
): Promise<void> {
  await mkdir(pluginsDir, { recursive: true });
  const final = path.join(pluginsDir, fileName);
  const tmp = `${final}.tmp`;
  const body = JSON.stringify({ version: 2, plugins: data.plugins }, null, 2);
  await writeFile(tmp, body, 'utf8');
  try {
    await rename(tmp, final);
  } catch {
    // Fallback when rename races or crosses volumes.
    await writeFile(final, body, 'utf8');
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}
