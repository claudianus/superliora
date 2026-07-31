import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetCodeMapForWorkspace } from '#/codemap/code-map';
import {
  formatRepoIndexRebuildResultLine,
  rebuildRepoIndex,
} from '#/repo-index/rebuild';
import {
  resetContentIndexForWorkspace,
  setContentIndexDbPathOverrideForTests,
} from '#/repo-index/content-indexer';
import { REPO_INDEX_ENGINE_ENV } from '#/repo-index/status';

let savedSuperlioraHome: string | undefined;
let testHome: string;

beforeAll(() => {
  savedSuperlioraHome = process.env['SUPERLIORA_HOME'];
  testHome = mkdtempSync(join(tmpdir(), 'repo-index-rebuild-home-'));
  process.env['SUPERLIORA_HOME'] = testHome;
});

afterAll(() => {
  if (savedSuperlioraHome === undefined) delete process.env['SUPERLIORA_HOME'];
  else process.env['SUPERLIORA_HOME'] = savedSuperlioraHome;
  rmSync(testHome, { recursive: true, force: true });
  setContentIndexDbPathOverrideForTests(null);
});

function makeGitWorkspace(files: Record<string, string>): string {
  const ws = mkdtempSync(join(tmpdir(), 'repo-index-rebuild-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(ws, name), content, 'utf8');
  }
  spawnSync('git', ['init', '-q'], { cwd: ws });
  spawnSync('git', ['add', '-A'], { cwd: ws });
  return ws;
}

describe('rebuildRepoIndex', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = makeGitWorkspace({
      'lib.ts': 'export function rebuildProbe() { return 1; }\nconst UniqueRebuildFtsToken = 7;\n',
      'readme.md': '# docs\nUniqueRebuildFtsToken\n',
    });
    setContentIndexDbPathOverrideForTests((dir) =>
      join(testHome, 'repo-index', `${dir.replaceAll(/[^\w.-]+/g, '_')}.sqlite`),
    );
  });

  afterEach(() => {
    resetCodeMapForWorkspace(workspace);
    resetContentIndexForWorkspace(workspace);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('rebuilds symbol codemap and sqlite FTS when engine=sqlite', () => {
    const result = rebuildRepoIndex(workspace, { env: { [REPO_INDEX_ENGINE_ENV]: 'sqlite' } });

    expect(result.ok).toBe(true);
    expect(result.warmth).toBe('warm');
    expect(result.codemapFiles).toBeGreaterThan(0);
    expect(result.codemapSymbols).toBeGreaterThan(0);
    expect(result.contentSkipped).toBe(false);
    expect(result.contentFiles).toBeGreaterThan(0);
    expect(result.contentLines).toBeGreaterThan(0);
    expect(result.ms).toBeGreaterThanOrEqual(0);

    const line = formatRepoIndexRebuildResultLine(result);
    expect(line).toContain('Last rebuild: warm');
    expect(line).toContain('FTS');
    expect(line).toMatch(/\d+ms$/);
  });

  it('skips FTS content when engine=stub', () => {
    const result = rebuildRepoIndex(workspace, { env: { [REPO_INDEX_ENGINE_ENV]: 'stub' } });

    expect(result.ok).toBe(true);
    expect(result.contentSkipped).toBe(true);
    expect(result.contentSkipReason).toContain('engine=stub');

    const line = formatRepoIndexRebuildResultLine(result);
    expect(line).toContain('FTS skipped');
  });

  it('fails gracefully outside a git workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-index-nogit-'));
    try {
      const result = rebuildRepoIndex(dir);
      expect(result.ok).toBe(false);
      expect(result.note).toContain('not a git repo');
      expect(formatRepoIndexRebuildResultLine(result)).toContain('Last rebuild: failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
