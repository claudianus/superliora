import { join } from 'node:path';

/** Canonical workspace-local SuperLiora data directory. */
export const WORKSPACE_DIR = '.superliora';

/** Build a workspace-relative path under the workspace data directory. */
export function workspacePath(_cwd, ...segments) {
  return join(WORKSPACE_DIR, ...segments);
}
