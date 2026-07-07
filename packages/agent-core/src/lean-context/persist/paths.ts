import { join } from 'pathe';

import type { WorkspaceConfig } from '../../tools/support/workspace';

export const INDEX_DIR_NAME = '.superliora/index';
export const COMPOSE_CACHE_DIR_NAME = '.superliora/compose-cache';

export function workspaceIndexDir(workspace: WorkspaceConfig): string {
  return join(workspace.workspaceDir, INDEX_DIR_NAME);
}

export function workspaceComposeCacheDir(workspace: WorkspaceConfig): string {
  return join(workspace.workspaceDir, COMPOSE_CACHE_DIR_NAME);
}

export function manifestPath(indexDir: string): string {
  return join(indexDir, 'manifest.json');
}

export function bm25Path(indexDir: string): string {
  return join(indexDir, 'bm25.json');
}

export function graphPath(indexDir: string): string {
  return join(indexDir, 'graph.json');
}
