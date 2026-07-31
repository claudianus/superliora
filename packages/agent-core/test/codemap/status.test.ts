import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as codeMap from '#/codemap/code-map';
import { CodeIndexer } from '#/codemap/indexer';
import {
  CODEMAP_SYMBOL_VIA_REPOQUERY_TIP,
  formatCodemapDbLine,
  formatCodemapStatusLine,
  getCodemapStatus,
  isCodemapGitWorkspace,
} from '#/codemap/status';

function initGitRepo(dir: string, files: Record<string, string>): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
    execSync(`git add ${name}`, { cwd: dir, stdio: 'ignore' });
  }
  execSync('git commit -m "init"', { cwd: dir, stdio: 'ignore' });
}

describe('getCodemapStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unavailable when workspace is not a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codemap-status-nogit-'));
    try {
      const probe = getCodemapStatus(dir);
      expect(probe.warmth).toBe('unavailable');
      expect(probe.gitRepo).toBe(false);
      expect(isCodemapGitWorkspace(dir)).toBe(false);
      expect(formatCodemapStatusLine(probe)).toContain('unavailable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports warm with file/symbol counts when sqlite index exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codemap-status-warm-'));
    const dbPath = join(dir, 'index.sqlite');
    try {
      initGitRepo(dir, { 'alpha.ts': 'export function alpha() {}\n' });
      const indexer = new CodeIndexer({ root: dir, dbPath, files: ['alpha.ts'] });
      indexer.update();
      indexer.close();

      vi.spyOn(codeMap, 'resolveCodemapDbPath').mockReturnValue(dbPath);

      const probe = getCodemapStatus(dir);
      expect(probe.warmth).toBe('warm');
      expect(probe.fileCount).toBe(1);
      expect(probe.symbolCount).toBeGreaterThan(0);
      expect(formatCodemapStatusLine(probe)).toContain('warm');
      expect(formatCodemapDbLine(probe)).toContain(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports cold in git repo without persisted sqlite rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codemap-status-cold-'));
    try {
      initGitRepo(dir, { 'beta.ts': 'export const beta = 1;\n' });
      vi.spyOn(codeMap, 'resolveCodemapDbPath').mockReturnValue(join(dir, 'missing.sqlite'));

      const probe = getCodemapStatus(dir);
      expect(probe.warmth).toBe('cold');
      expect(probe.note).toBe(CODEMAP_SYMBOL_VIA_REPOQUERY_TIP);
      expect(formatCodemapStatusLine(probe)).toContain('cold');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
