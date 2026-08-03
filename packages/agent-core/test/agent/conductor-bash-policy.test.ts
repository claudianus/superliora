import { describe, expect, it } from 'vitest';

import { isConductorBashCommandReadOnly } from '../../src/agent/conductor-bash-policy';

/**
 * Conductor Bash read-only classifier (checklist V1-5). Allowlist semantics:
 * anything unrecognized is treated as a write, so a false deny only delegates
 * the command to a worker while a false allow would let direct work run on
 * the conductor lane.
 */
describe('isConductorBashCommandReadOnly', () => {
  it('allows git inspection commands', () => {
    for (const command of [
      'git status',
      'git status --short',
      'git log --oneline -10',
      'git diff',
      'git diff --staged',
      'git show HEAD',
      'git branch',
      'git branch -a',
      'git tag --list',
      'git stash list',
      'git stash show',
      'git remote -v',
      'git config --get user.email',
      'git config --list',
      'git worktree list',
      'git rev-parse HEAD',
      'git -C /repo log -1',
      'git --work-tree /repo status',
    ]) {
      expect(isConductorBashCommandReadOnly(command), command).toBe(true);
    }
  });

  it('allows plain inspection commands', () => {
    for (const command of [
      'ls -la',
      'pwd',
      'cat package.json',
      'head -20 README.md',
      'rg TODO src',
      'find . -name "*.ts" -maxdepth 2',
      'wc -l src/index.ts',
      'tree packages',
      'du -sh node_modules',
      'env',
    ]) {
      expect(isConductorBashCommandReadOnly(command), command).toBe(true);
    }
  });

  it('denies package-manager, build, and migration commands', () => {
    for (const command of [
      'pnpm install',
      'npm install',
      'npm ci',
      'yarn add left-pad',
      'pnpm run build',
      'pnpm build',
      'make',
      'tsc',
      'node scripts/migrate.mjs',
      'cargo build',
      'docker build .',
    ]) {
      expect(isConductorBashCommandReadOnly(command), command).toBe(false);
    }
  });

  it('denies git mutation commands', () => {
    for (const command of [
      'git commit -m "x"',
      'git push',
      'git push origin main',
      'git pull',
      'git fetch origin',
      'git merge feature',
      'git rebase main',
      'git reset --hard HEAD~1',
      'git checkout -b new',
      'git switch main',
      'git add .',
      'git rm file',
      'git clean -fd',
      'git cherry-pick abc123',
      'git branch -D stale',
      'git tag v1.0.0',
      'git tag -d v0.9',
      'git stash push',
      'git stash drop',
      'git config user.name bot',
      'git remote add origin url',
      'git worktree add ../wt',
    ]) {
      expect(isConductorBashCommandReadOnly(command), command).toBe(false);
    }
  });

  it('denies file and system mutation commands', () => {
    for (const command of [
      'rm -rf dist',
      'mv a b',
      'cp a b',
      'mkdir out',
      'touch newfile',
      'chmod +x script.sh',
      'sed -i s/a/b/ file',
      'kill 1234',
      'systemctl restart app',
      'curl -X POST https://example.com',
    ]) {
      expect(isConductorBashCommandReadOnly(command), command).toBe(false);
    }
  });

  it('denies chaining, redirection, and substitution tricks', () => {
    for (const command of [
      'git status && rm x',
      'git status; pnpm install',
      'echo ok > file',
      'echo ok >> file',
      'cat $(echo secret)',
      'cat `ls`',
      'find . -delete',
      'find . -exec rm {} ;',
      'ls | tee out.txt',
      'sudo git status',
      'bash -c "rm -rf /"',
      'source ./env.sh',
      '. ./env.sh',
      'eval "$CMD"',
      'sleep 100 &',
    ]) {
      expect(isConductorBashCommandReadOnly(command), command).toBe(false);
    }
  });

  it('allows read-only pipelines where every segment is known-safe', () => {
    expect(isConductorBashCommandReadOnly('git log --oneline | head -5')).toBe(true);
    expect(isConductorBashCommandReadOnly('ls -la | grep src')).toBe(true);
  });

  it('denies pipelines with an unknown or mutating segment', () => {
    expect(isConductorBashCommandReadOnly('git log | node reporter.js')).toBe(false);
    expect(isConductorBashCommandReadOnly('ls | xargs rm')).toBe(false);
  });

  it('denies missing, empty, and non-string commands', () => {
    expect(isConductorBashCommandReadOnly(undefined)).toBe(false);
    expect(isConductorBashCommandReadOnly('')).toBe(false);
    expect(isConductorBashCommandReadOnly('   ')).toBe(false);
    expect(isConductorBashCommandReadOnly(42)).toBe(false);
  });
});
