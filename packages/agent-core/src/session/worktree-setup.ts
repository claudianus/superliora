/**
 * Per-worktree environment setup: copy ignored files, run repo recipes,
 * assign a unique PORT for parallel dev servers.
 *
 * Recipe files (first match wins):
 *   .superliora/worktrees.json
 *   .cursor/worktrees.json
 *
 * Shape (Cursor-compatible):
 *   { "setup-worktree": string[] | string, "setup-worktree-windows"?, "setup-worktree-unix"? }
 * Extra SuperLiora key: { "copy": [".env", ".env.local"] }
 */

import { existsSync, readFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'pathe';

const JOB_DEV_SERVER_BASE_PORT = 3000;

interface WorktreeSetupRecipe {
  readonly setupWorktree?: readonly string[];
  readonly copy?: readonly string[];
}

interface WorktreeSetupInput {
  readonly repoRoot: string;
  readonly worktreePath: string;
  readonly portOffset?: number;
  readonly platform?: NodeJS.Platform;
  readonly runCommand?: (
    cwd: string,
    command: string,
    env: Readonly<Record<string, string>>,
  ) => Promise<{ readonly ok: boolean; readonly stderr: string }>;
}

interface WorktreeSetupResult {
  readonly notes: readonly string[];
  readonly port?: number;
}

export function jobDevServerPort(offset: number | undefined): number | undefined {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return undefined;
  return JOB_DEV_SERVER_BASE_PORT + Math.floor(offset);
}

export function loadWorktreeSetupRecipe(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): WorktreeSetupRecipe {
  const candidates = [
    join(repoRoot, '.superliora', 'worktrees.json'),
    join(repoRoot, '.cursor', 'worktrees.json'),
  ];
  for (const path of candidates) {
    const parsed = readRecipeFile(path, platform);
    if (parsed !== undefined) return parsed;
  }
  return { copy: defaultEnvCopies(repoRoot) };
}

function readRecipeFile(
  path: string,
  platform: NodeJS.Platform,
): WorktreeSetupRecipe | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const osKey = platform === 'win32' ? 'setup-worktree-windows' : 'setup-worktree-unix';
    const commands = commandsFrom(raw[osKey]) ?? commandsFrom(raw['setup-worktree']);
    const copy = Array.isArray(raw['copy'])
      ? raw['copy'].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : undefined;
    return {
      ...(commands !== undefined ? { setupWorktree: commands } : {}),
      ...(copy !== undefined && copy.length > 0 ? { copy } : {}),
    };
  } catch {
    return undefined;
  }
}

function commandsFrom(value: unknown): readonly string[] | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return list.length > 0 ? list : undefined;
}

function defaultEnvCopies(repoRoot: string): readonly string[] {
  try {
    return readdirSync(repoRoot).filter(
      (name) => name === '.env' || name.startsWith('.env.'),
    );
  } catch {
    return [];
  }
}

async function defaultRunCommand(
  cwd: string,
  command: string,
  env: Readonly<Record<string, string>>,
): Promise<{ ok: boolean; stderr: string }> {
  try {
    // Lazy import so suites that mock `node:child_process` without `exec`
    // can still load job-runtime (which imports this module).
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(exec)(command, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      timeout: 120_000,
    });
    return { ok: true, stderr: '' };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    return { ok: false, stderr: (err.stderr ?? err.message ?? String(error)).slice(0, 400) };
  }
}

function copyRelativeFile(repoRoot: string, worktreePath: string, rel: string): string | undefined {
  const from = join(repoRoot, rel);
  const to = join(worktreePath, rel);
  if (!existsSync(from) || existsSync(to)) return undefined;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return `copied ${rel}`;
}

export async function setupJobWorktree(input: WorktreeSetupInput): Promise<WorktreeSetupResult> {
  const notes: string[] = [];
  const recipe = loadWorktreeSetupRecipe(input.repoRoot, input.platform ?? process.platform);
  const port = jobDevServerPort(input.portOffset);
  const env: Record<string, string> = {
    ROOT_WORKTREE_PATH: input.repoRoot,
    ...(port !== undefined ? { JOB_PORT: String(port), PORT: String(port) } : {}),
  };

  for (const rel of recipe.copy ?? []) {
    try {
      const copied = copyRelativeFile(input.repoRoot, input.worktreePath, rel);
      if (copied !== undefined) notes.push(copied);
    } catch (error) {
      notes.push(`copy ${rel} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const run = input.runCommand ?? defaultRunCommand;
  for (const command of recipe.setupWorktree ?? []) {
    const result = await run(input.worktreePath, command, env);
    if (result.ok) {
      notes.push(`setup: ${command}`);
    } else {
      notes.push(`setup failed (${command}): ${result.stderr}`);
    }
  }

  if (port !== undefined) {
    notes.push(`port: ${String(port)} (offset ${String(input.portOffset ?? 0)})`);
  }
  return { notes, port };
}

/** First unused port offset among jobs that already have one. */
export function nextPortOffset(used: readonly (number | undefined)[]): number {
  const taken = new Set(used.filter((n): n is number => n !== undefined && Number.isFinite(n)));
  let offset = 0;
  while (taken.has(offset)) offset += 1;
  return offset;
}
