import { join } from 'pathe';

/** Workspace-local SuperLiora data directory (evidence, wiki, bench artifacts). */
export const WORKSPACE_DATA_DIR = '.superliora';

/** Canonical LLM Wiki root for prompts and new workspaces. */
export const CANONICAL_LLM_WIKI_ROOT = `${WORKSPACE_DATA_DIR}/wiki`;

/** Canonical evidence root for prompts and new workspaces. */
export const CANONICAL_EVIDENCE_ROOT = `${WORKSPACE_DATA_DIR}/evidence`;

/** Canonical Ultrawork run evidence root for new workspaces. */
export const CANONICAL_ULTRAWORK_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/ultrawork-runs`;

export function resolveWorkspaceDataDir(workDir: string): string {
  return WORKSPACE_DATA_DIR;
}

/** Build a workspace-relative path under the workspace data directory. */
export function workspaceRelativePath(workDir: string, ...segments: string[]): string {
  return join(WORKSPACE_DATA_DIR, ...segments);
}

export function resolveLlmWikiRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'wiki');
}

export function resolveLlmWikiPaths(workDir: string): {
  readonly wikiRootPath: string;
  readonly wikiIndexPath: string;
  readonly wikiManifestPath: string;
} {
  const wikiRootPath = resolveLlmWikiRoot(workDir);
  return {
    wikiRootPath,
    wikiIndexPath: `${wikiRootPath}/index.md`,
    wikiManifestPath: `${wikiRootPath}/manifest.json`,
  };
}

export function resolveUltraworkEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence', 'ultrawork-runs');
}

export function resolveEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence');
}

export const KNOWLEDGE_MAP_FILENAME = 'liora-knowledge-map.json';
