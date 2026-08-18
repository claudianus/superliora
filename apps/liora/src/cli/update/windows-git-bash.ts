import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export interface FindWindowsGitBashDeps {
  /** Env snapshot (PATH/Path, ProgramFiles, ProgramFiles(x86), LOCALAPPDATA). */
  readonly env?: Readonly<Partial<Record<string, string>>>;
  readonly exists?: (filePath: string) => boolean;
}

/**
 * Locate Git for Windows' bash.exe for running the checkout update script.
 *
 * Never resolve `bash` from PATH directly: on stock Windows that is
 * System32's WSL launcher, which would run the script inside a Linux distro
 * against the wrong filesystem. Instead derive the Git install root from
 * git.exe on PATH, then fall back to the standard install locations.
 *
 * Win32 path semantics are used unconditionally — the paths under inspection
 * are Windows paths even when tests run elsewhere.
 */
export function findWindowsGitBash(deps: FindWindowsGitBashDeps = {}): string | null {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;

  const roots: string[] = [];
  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  for (const entry of pathValue.split(win32.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    // e.g. C:\Program Files\Git\cmd -> C:\Program Files\Git
    if (exists(win32.join(trimmed, 'git.exe'))) {
      roots.push(win32.resolve(trimmed, '..'));
    }
  }
  const programFiles = env['ProgramFiles'];
  if (programFiles !== undefined && programFiles.length > 0) {
    roots.push(win32.join(programFiles, 'Git'));
  }
  const programFilesX86 = env['ProgramFiles(x86)'];
  if (programFilesX86 !== undefined && programFilesX86.length > 0) {
    roots.push(win32.join(programFilesX86, 'Git'));
  }
  const localAppData = env['LOCALAPPDATA'];
  if (localAppData !== undefined && localAppData.length > 0) {
    roots.push(win32.join(localAppData, 'Programs', 'Git'));
  }

  for (const root of roots) {
    const candidates = [
      win32.join(root, 'bin', 'bash.exe'),
      win32.join(root, 'usr', 'bin', 'bash.exe'),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}
