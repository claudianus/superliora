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
