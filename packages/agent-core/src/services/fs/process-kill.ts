import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Terminate a spawned process and, on Windows, everything it started.
 *
 * `ChildProcess.kill()` on Windows only signals the direct child, so a
 * `rg`/`git` that spawned helpers survives the kill and keeps the workspace
 * directory locked — which then blocks worktree removal, directory cleanup,
 * and the next scan. `taskkill /T` takes the tree.
 *
 * Shared so the git, search, and shell paths cannot drift apart: three copies
 * of this existed, and the search path had none, leaving a killed scan holding
 * the cwd for the life of the process.
 */
export function killProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {});
      return;
    } catch {
      // fall through to the direct kill below
    }
  }
  try {
    child.kill();
  } catch {
    // The process is already gone, or the platform refused the signal. There is
    // nothing to escalate to, and callers treat this as best-effort teardown.
  }
}
