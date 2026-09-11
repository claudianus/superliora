import type { Kaos } from '@superliora/kaos';
const DEFAULT_TIMEOUT_MS = 60_000;
/** Cap collected stdout/stderr so a chatty git command cannot balloon memory. */
const GIT_OUTPUT_CAP_CHARS = 10 * 1024 * 1024;
export interface GitCommandResult { readonly ok: boolean; readonly stdout: string; readonly stderr: string; readonly exitCode: number | null; }
export async function runGit(kaos: Kaos, cwd: string, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitCommandResult> { return runCommand(kaos, ['git', '-C', cwd, ...args], timeoutMs); }
export async function runGh(kaos: Kaos, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitCommandResult> { return runCommand(kaos, ['gh', ...args], timeoutMs); }
async function runCommand(kaos: Kaos, args: readonly string[], timeoutMs: number): Promise<GitCommandResult> {
  try {
    const proc = await kaos.exec(...args); proc.stdin.end();
    const out = collect(proc.stdout, GIT_OUTPUT_CAP_CHARS), err = collect(proc.stderr, GIT_OUTPUT_CAP_CHARS);
    const t = setTimeout(() => { void proc.kill('SIGTERM'); }, timeoutMs);
    try { const code = await proc.wait(); return { ok: code === 0, stdout: await out, stderr: await err, exitCode: code }; } finally { clearTimeout(t); }
  } catch (error) { return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: null }; }
}
function collect(s: NodeJS.ReadableStream, cap: number): Promise<string> { return new Promise((r) => { let d = ''; s.setEncoding('utf8'); s.on('data', (c) => { if (d.length < cap) d += c; }); s.on('end', () =>{  r(d); }); s.on('error', () =>{  r(d); }); }); }
export async function createWorktree(kaos: Kaos, root: string, target: string, branch: string, base: string): Promise<GitCommandResult> { return runGit(kaos, root, ['worktree', 'add', '-b', branch, target, base]); }
/** Reattach an existing branch to a worktree path (`git worktree add <path> <branch>`). */
export async function attachWorktree(kaos: Kaos, root: string, target: string, branch: string): Promise<GitCommandResult> { return runGit(kaos, root, ['worktree', 'add', target, branch]); }
export async function removeWorktree(kaos: Kaos, root: string, target: string): Promise<void> { await runGit(kaos, root, ['worktree', 'remove', '--force', target]); await runGit(kaos, root, ['worktree', 'prune']); }

// ── GitHub CLI auth readiness (deployment lane) ────────────────────────────
// The push lane shells out to `gh` (repo create, Pages enable). Login lives
// in the user's gh config (hosts.yml), which tools must never read directly
// (sensitive path policy) — `gh auth status` is the only sanctioned probe.

export type GhCliAuthState = 'ok' | 'logged_out' | 'binary_missing' | 'unknown';

export interface GhCliAuthStatus {
  readonly state: GhCliAuthState;
  /** Logged-in account from `gh auth status` when available. */
  readonly account?: string;
  /** Compact human-readable reason for non-ok states. */
  readonly detail?: string;
}

/** Parse `gh api user --jq .login` output; empty login is logged_out. */
export function parseGhAccountLogin(stdout: string): string | undefined {
  const login = stdout.trim();
  return login.length > 0 && !login.startsWith('{') ? login : undefined;
}

/**
 * Probe GitHub CLI login state without reading gh config files.
 * `gh api user` doubles as the credential check: a stale token fails here
 * even when hosts.yml still lists an account.
 */
export async function checkGhCliAuth(
  kaos: Kaos,
  options: { readonly timeoutMs?: number } = {},
): Promise<GhCliAuthStatus> {
  const res = await runGh(kaos, ['api', 'user', '--jq', '.login'], options.timeoutMs ?? 15_000);
  if (res.ok) {
    return { state: 'ok', account: parseGhAccountLogin(res.stdout) };
  }
  const blob = `${res.stderr}\n${res.stdout}`.toLowerCase();
  if (blob.includes('executable file not found') || blob.includes('no such file') || blob.includes('command not found')) {
    return {
      state: 'binary_missing',
      detail: 'gh CLI is not installed (https://cli.github.com). Remote push and GitHub Pages enable cannot run.',
    };
  }
  if (blob.includes('gh auth login') || blob.includes('401') || blob.includes('unauthorized') || blob.includes('not logged in') || blob.includes('no accessible token')) {
    return {
      state: 'logged_out',
      detail: 'GitHub CLI is not logged in. Run `gh auth login` (or /github-connect in the TUI) and retry the push.',
    };
  }
  return {
    state: 'unknown',
    detail: `gh auth probe failed (exit ${String(res.exitCode)}): ${(res.stderr || res.stdout).trim().slice(0, 200)}`,
  };
}
