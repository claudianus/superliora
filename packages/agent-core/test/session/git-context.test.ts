import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalKaos } from '@superliora/kaos';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectGitContext,
  parseProjectName,
  sanitizeRemoteUrl,
} from '../../src/session/git-context';
import { runGit } from '../../src/session/job/git';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(initialize = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'liora-git-context-'));
  tempDirs.push(cwd);
  const kaos = await LocalKaos.create();
  const git = async (...args: string[]) => {
    const result = await runGit(kaos, cwd, args);
    if (!result.ok) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  if (initialize) {
    await git('init', '--initial-branch=main');
    await git('config', 'user.name', 'Git Fixture');
    await git('config', 'user.email', 'fixture@example.test');
    await git('config', 'commit.gpgsign', 'false');
  }
  return { kaos, cwd, git };
}

describe('collectGitContext', () => {
  it('identifies a non-repository without claiming other Git failures are not-a-repo', async () => {
    const { kaos, cwd } = await fixture(false);
    expect(await collectGitContext(kaos, cwd)).toBe(
      '<git-context status="unavailable" reason="not-a-repo"/>',
    );
    expect(await collectGitContext(kaos, join(cwd, 'missing'))).toBe('');
  });

  it('reads branch, sanitized remote, actual dirty files, and committed history', async () => {
    const { kaos, cwd, git } = await fixture();
    await git('remote', 'add', 'origin', 'https://user:pass@github.com/acme/widgets.git');
    await writeFile(join(cwd, 'tracked.txt'), 'original\n');
    await git('add', 'tracked.txt');
    await git('commit', '-m', 'feat: add tracked fixture');
    const hash = await git('rev-parse', '--short', 'HEAD');
    await writeFile(join(cwd, 'tracked.txt'), 'changed\n');
    await writeFile(join(cwd, 'new.txt'), 'new\n');

    const block = await collectGitContext(kaos, cwd);
    expect(block).toContain(`Working directory: ${cwd}`);
    expect(block).toContain('Remote: https://github.com/acme/widgets.git');
    expect(block).not.toContain('user:pass');
    expect(block).toContain('Project: acme/widgets');
    expect(block).toContain('Branch: main');
    expect(block).toContain('Dirty files (2):');
    expect(block).toContain('?? new.txt');
    expect(block).toContain('M tracked.txt');
    expect(block).toContain(`${hash} feat: add tracked fixture`);
  });

  it('retains an unborn branch and status when origin and commits are absent', async () => {
    const { kaos, cwd } = await fixture();
    await writeFile(join(cwd, 'new.txt'), 'new\n');
    const block = await collectGitContext(kaos, cwd);
    expect(block).toContain('Branch: main');
    expect(block).toContain('?? new.txt');
    expect(block).not.toContain('Remote:');
    expect(block).not.toContain('Recent commits:');
  });

  it('omits a detached branch and a private remote without dropping commit history', async () => {
    const { kaos, cwd, git } = await fixture();
    await git('remote', 'add', 'origin', 'git@example.test:secret/repo.git');
    await git('commit', '--allow-empty', '-m', 'feat: initial fixture');
    await git('checkout', '--detach');
    const block = await collectGitContext(kaos, cwd);
    expect(block).not.toContain('Branch:');
    expect(block).not.toContain('Remote:');
    expect(block).not.toContain('Project:');
    expect(block).not.toContain('secret/repo');
    expect(block).toContain('feat: initial fixture');
  });

  it('reports the true dirty-file count while limiting displayed paths', async () => {
    const { kaos, cwd } = await fixture();
    await Promise.all(Array.from({ length: 25 }, (_, i) =>
      writeFile(join(cwd, `file-${String(i).padStart(2, '0')}.txt`), 'new\n')));
    const block = await collectGitContext(kaos, cwd);
    expect(block).toContain('Dirty files (25):');
    expect(block).toContain('... and 5 more');
    expect(block).toContain('file-19.txt');
    expect(block).not.toContain('file-20.txt');
  });
});

describe('sanitizeRemoteUrl', () => {
  it('strips credentials from an allowed HTTPS host', () => {
    expect(sanitizeRemoteUrl('https://user:pass@github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets.git',
    );
  });

  it('passes through an allowed SSH host', () => {
    expect(sanitizeRemoteUrl('git@github.com:acme/widgets.git')).toBe(
      'git@github.com:acme/widgets.git',
    );
  });

  it('rejects an unrecognized HTTPS host', () => {
    expect(sanitizeRemoteUrl('https://internal.corp/acme/widgets.git')).toBeNull();
  });

  it('rejects an unrecognized SSH host', () => {
    expect(sanitizeRemoteUrl('git@internal.corp:acme/widgets.git')).toBeNull();
  });

  it('passes through the SourceHut git host', () => {
    expect(sanitizeRemoteUrl('git@git.sr.ht:~user/repo')).toBe('git@git.sr.ht:~user/repo');
  });
});

describe('parseProjectName', () => {
  it('extracts owner/repo from an SSH URL', () => {
    expect(parseProjectName('git@github.com:acme/widgets.git')).toBe('acme/widgets');
  });

  it('extracts owner/repo from an HTTPS URL', () => {
    expect(parseProjectName('https://github.com/acme/widgets.git')).toBe('acme/widgets');
  });

  it('extracts owner/repo from an HTTPS URL without a .git suffix', () => {
    expect(parseProjectName('https://gitee.com/acme/widgets')).toBe('acme/widgets');
  });

  it('keeps the full namespace for nested GitLab groups (HTTPS)', () => {
    expect(parseProjectName('https://gitlab.com/group/subgroup/repo.git')).toBe(
      'group/subgroup/repo',
    );
  });

  it('keeps the full namespace for nested GitLab groups (SSH)', () => {
    expect(parseProjectName('git@gitlab.com:group/subgroup/repo.git')).toBe('group/subgroup/repo');
  });
});
