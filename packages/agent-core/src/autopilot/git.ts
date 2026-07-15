import type { Kaos } from '@superliora/kaos';
const DEFAULT_TIMEOUT_MS = 60_000;
export interface GitCommandResult { readonly ok: boolean; readonly stdout: string; readonly stderr: string; readonly exitCode: number | null; }
export async function runGit(kaos: Kaos, cwd: string, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitCommandResult> { return runCommand(kaos, ['git', '-C', cwd, ...args], timeoutMs); }
export async function runGh(kaos: Kaos, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitCommandResult> { return runCommand(kaos, ['gh', ...args], timeoutMs); }
async function runCommand(kaos: Kaos, args: readonly string[], timeoutMs: number): Promise<GitCommandResult> {
  try {
    const proc = await kaos.exec(...args); proc.stdin.end();
    const out = collect(proc.stdout), err = collect(proc.stderr);
    const t = setTimeout(() => { void proc.kill('SIGTERM'); }, timeoutMs);
    try { const code = await proc.wait(); return { ok: code === 0, stdout: await out, stderr: await err, exitCode: code }; } finally { clearTimeout(t); }
  } catch (e) { return { ok: false, stdout: '', stderr: e instanceof Error ? e.message : String(e), exitCode: null }; }
}
function collect(s: NodeJS.ReadableStream): Promise<string> { return new Promise((r) => { let d = ''; s.setEncoding('utf8'); s.on('data', (c) => { d += c; }); s.on('end', () => r(d)); s.on('error', () => r(d)); }); }
export async function createWorktree(kaos: Kaos, root: string, target: string, branch: string, base: string): Promise<GitCommandResult> { return runGit(kaos, root, ['worktree', 'add', '-b', branch, target, base]); }
export async function removeWorktree(kaos: Kaos, root: string, target: string): Promise<void> { await runGit(kaos, root, ['worktree', 'remove', '--force', target]); await runGit(kaos, root, ['worktree', 'prune']); }
export async function commitAll(kaos: Kaos, cwd: string, msg: string): Promise<GitCommandResult> { const a = await runGit(kaos, cwd, ['add', '-A']); return a.ok ? runGit(kaos, cwd, ['commit', '-m', msg]) : a; }
