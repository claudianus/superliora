import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  jobDevServerPort,
  loadWorktreeSetupRecipe,
  nextPortOffset,
  setupJobWorktree,
} from '../../src/session/worktree-setup';

describe('worktree setup recipe', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wt-setup-'));
    dirs.push(dir);
    return dir;
  }

  it('allocates unique port offsets and maps them to 3000+', () => {
    expect(nextPortOffset([])).toBe(0);
    expect(nextPortOffset([0, 1])).toBe(2);
    expect(jobDevServerPort(0)).toBe(3000);
    expect(jobDevServerPort(2)).toBe(3002);
  });

  it('copies .env files and runs recipe commands', async () => {
    const root = tmp();
    const tree = join(root, 'tree');
    mkdirSync(tree);
    writeFileSync(join(root, '.env'), 'SECRET=1\n');
    mkdirSync(join(root, '.superliora'));
    writeFileSync(
      join(root, '.superliora', 'worktrees.json'),
      JSON.stringify({
        'setup-worktree': ['echo setup'],
        copy: ['.env'],
      }),
    );
    const ran: string[] = [];
    const result = await setupJobWorktree({
      repoRoot: root,
      worktreePath: tree,
      portOffset: 1,
      runCommand: async (_cwd, command) => {
        ran.push(command);
        return { ok: true, stderr: '' };
      },
    });
    expect(ran).toEqual(['echo setup']);
    expect(result.port).toBe(3001);
    expect(result.notes.some((line) => line.includes('copied .env'))).toBe(true);
    expect(result.notes.some((line) => line.startsWith('port: 3001'))).toBe(true);
  });

  it('prefers .superliora/worktrees.json over .cursor/worktrees.json', () => {
    const root = tmp();
    mkdirSync(join(root, '.superliora'));
    mkdirSync(join(root, '.cursor'));
    writeFileSync(
      join(root, '.superliora', 'worktrees.json'),
      JSON.stringify({ 'setup-worktree': ['from-superliora'] }),
    );
    writeFileSync(
      join(root, '.cursor', 'worktrees.json'),
      JSON.stringify({ 'setup-worktree': ['from-cursor'] }),
    );
    expect(loadWorktreeSetupRecipe(root).setupWorktree).toEqual(['from-superliora']);
  });
});
