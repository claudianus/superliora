import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_LLM_WIKI_ROOT,
  WORKSPACE_DATA_DIR,
  resolveLlmWikiPaths,
  resolveWorkspaceDataDir,
} from '#/constant/workspace-data';

describe('workspace-data', () => {
  it('uses .superliora for all workspaces', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'liora-workspace-empty-'));
    try {
      expect(resolveWorkspaceDataDir(workDir)).toBe(WORKSPACE_DATA_DIR);
      expect(resolveLlmWikiPaths(workDir).wikiRootPath).toBe(CANONICAL_LLM_WIKI_ROOT);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
