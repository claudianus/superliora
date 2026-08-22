/**
 * Workspace path helpers for /folder and runtime workDir switches.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

const PROJECT_MARKERS = [
  '.git',
  '.superliora',
  '.claude',
  'AGENTS.md',
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'composer.json',
  'CMakeLists.txt',
] as const;

const SKIP_CHILD_NAMES = new Set([
  'node_modules',
  'AppData',
  'Application Data',
  'Local Settings',
  'Cookies',
  'Recent',
  'SendTo',
  'Start Menu',
  'Templates',
  'NetHood',
  'PrintHood',
  'IntelGraphicsProfiles',
]);

const MAX_CHILDREN = 48;

export interface WorkspaceDirOk {
  readonly ok: true;
  readonly path: string;
}

export interface WorkspaceDirErr {
  readonly ok: false;
  readonly reason: 'empty' | 'missing' | 'not-dir';
  readonly path: string;
}

export type WorkspaceDirResult = WorkspaceDirOk | WorkspaceDirErr;

export interface WorkspacePlace {
  readonly label: string;
  readonly path: string;
}

export function sameWorkspaceDir(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function expandUserPath(input: string, home: string = homedir()): string {
  const trimmed = input.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(home, trimmed.slice(2));
  }
  return trimmed;
}

export function displayWorkspacePath(path: string, home: string = homedir()): string {
  const resolved = resolve(path);
  const homeResolved = resolve(home);
  if (sameWorkspaceDir(resolved, homeResolved)) return '~';
  const prefix = homeResolved.endsWith(sep) ? homeResolved : homeResolved + sep;
  const pathForCompare = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const prefixForCompare = process.platform === 'win32' ? prefix.toLowerCase() : prefix;
  if (pathForCompare.startsWith(prefixForCompare)) {
    return '~' + sep + resolved.slice(prefix.length);
  }
  return resolved;
}

export function looksLikeProjectRoot(
  dir: string,
  exists: (path: string) => boolean = existsSync,
): boolean {
  return PROJECT_MARKERS.some((marker) => exists(join(dir, marker)));
}

export function wellKnownUserFolders(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const folders = [
    home,
    join(home, 'Desktop'),
    join(home, 'OneDrive', 'Desktop'),
    join(home, 'Documents'),
    join(home, 'Downloads'),
  ];
  const userProfile = (env['USERPROFILE'] ?? '').trim();
  if (userProfile.length > 0) folders.push(userProfile);
  return folders;
}

export function isGenericLaunchDir(
  dir: string,
  options: {
    readonly home?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly exists?: (path: string) => boolean;
  } = {},
): boolean {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const resolved = resolve(dir);
  if (looksLikeProjectRoot(resolved, exists)) return false;
  return wellKnownUserFolders(home, env).some((folder) => sameWorkspaceDir(resolved, folder));
}

export function resolveExistingWorkspaceDir(
  input: string,
  options: {
    readonly home?: string;
    readonly stat?: (path: string) => { isDirectory(): boolean };
  } = {},
): WorkspaceDirResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', path: trimmed };
  }
  const home = options.home ?? homedir();
  const expanded = expandUserPath(trimmed, home);
  const path = isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
  const stat = options.stat ?? defaultStat;
  try {
    const info = stat(path);
    if (!info.isDirectory()) return { ok: false, reason: 'not-dir', path };
    return { ok: true, path };
  } catch {
    return { ok: false, reason: 'missing', path };
  }
}

export function wellKnownPlaces(
  home: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): readonly WorkspacePlace[] {
  const candidates: readonly WorkspacePlace[] = [
    { label: 'Home', path: home },
    { label: 'Desktop', path: join(home, 'Desktop') },
    { label: 'OneDrive Desktop', path: join(home, 'OneDrive', 'Desktop') },
    { label: 'Documents', path: join(home, 'Documents') },
    { label: 'Downloads', path: join(home, 'Downloads') },
  ];
  const seen = new Set<string>();
  const places: WorkspacePlace[] = [];
  for (const place of candidates) {
    if (!exists(place.path)) continue;
    const key = process.platform === 'win32' ? resolve(place.path).toLowerCase() : resolve(place.path);
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ ...place, path: resolve(place.path) });
  }
  return places;
}

export function listWorkspaceChildren(
  dir: string,
  options: {
    readonly readdir?: typeof readdirSync;
  } = {},
): readonly string[] {
  const read = options.readdir ?? readdirSync;
  let entries;
  try {
    entries = read(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const children: string[] = [];
  for (const entry of entries) {
    if (children.length >= MAX_CHILDREN) break;
    if (entry.name === '.' || entry.name === '..' || entry.name.startsWith('.')) continue;
    if (SKIP_CHILD_NAMES.has(entry.name)) continue;
    const absolute = join(dir, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(absolute));
    if (!isDir) continue;
    children.push(absolute);
  }
  return children.toSorted((a, b) => basename(a).localeCompare(basename(b)));
}

export function parentWorkspaceDir(dir: string): string | undefined {
  const parent = dirname(resolve(dir));
  if (sameWorkspaceDir(parent, dir)) return undefined;
  return parent;
}

function defaultStat(path: string): { isDirectory(): boolean } {
  return statSync(path);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
