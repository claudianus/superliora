import * as pathe from 'pathe';

import type { WorkspaceConfig } from '../../tools/support/workspace';

export function relativeDisplayPath(path: string, workspace: WorkspaceConfig): string {
  if (path === workspace.workspaceDir) return '.';
  if (path.startsWith(workspace.workspaceDir + '/')) return path.slice(workspace.workspaceDir.length + 1);
  for (const dir of workspace.additionalDirs) {
    if (path === dir) return pathe.basename(dir);
    if (path.startsWith(dir + '/')) return path.slice(dir.length + 1);
  }
  return path;
}
