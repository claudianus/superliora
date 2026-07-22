import { describe, expect, it, vi } from 'vitest';

import { DashboardRouting } from '#/tui/controllers/dashboard-routing';
import { WorktreeManager } from '#/tui/controllers/worktree-manager';

describe('dashboard routing entry/exit (AC-5)', () => {
  it('toggle enters dashboard from inactive state', () => {
    const activateDashboard = vi.fn();
    const deactivateDashboard = vi.fn();
    const requestRender = vi.fn();
    const routing = new DashboardRouting({
      isDashboardActive: () => false,
      activateDashboard,
      deactivateDashboard,
      requestRender,
    });

    routing.toggle();
    expect(routing.isActive).toBe(true);
    expect(activateDashboard).toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalled();
  });

  it('toggle exits dashboard from active state', () => {
    const activateDashboard = vi.fn();
    const deactivateDashboard = vi.fn();
    const requestRender = vi.fn();
    const routing = new DashboardRouting({
      isDashboardActive: () => true,
      activateDashboard,
      deactivateDashboard,
      requestRender,
    });

    routing.toggle(); // enters
    routing.toggle(); // exits
    expect(routing.isActive).toBe(false);
    expect(deactivateDashboard).toHaveBeenCalled();
  });

  it('enter() is idempotent when already active', () => {
    const activateDashboard = vi.fn();
    const routing = new DashboardRouting({
      isDashboardActive: () => false,
      activateDashboard,
      deactivateDashboard: vi.fn(),
      requestRender: vi.fn(),
    });

    routing.enter();
    routing.enter();
    expect(activateDashboard).toHaveBeenCalledTimes(1);
  });

  it('exit() is idempotent when already inactive', () => {
    const deactivateDashboard = vi.fn();
    const routing = new DashboardRouting({
      isDashboardActive: () => false,
      activateDashboard: vi.fn(),
      deactivateDashboard,
      requestRender: vi.fn(),
    });

    routing.exit();
    expect(deactivateDashboard).not.toHaveBeenCalled();
  });

  it('enter then exit resumes conversation (deactivate called)', () => {
    const activateDashboard = vi.fn();
    const deactivateDashboard = vi.fn();
    const routing = new DashboardRouting({
      isDashboardActive: () => false,
      activateDashboard,
      deactivateDashboard,
      requestRender: vi.fn(),
    });

    routing.enter();
    expect(routing.isActive).toBe(true);
    routing.exit();
    expect(routing.isActive).toBe(false);
    expect(deactivateDashboard).toHaveBeenCalledTimes(1);
  });
});

describe('worktree manager (AC-5)', () => {
  it('generates unique branch names from quest id and name', () => {
    const manager = new WorktreeManager({
      repoRoot: '/tmp/repo',
      worktreeBase: '/tmp/worktrees',
    });

    // Access private method via type assertion for testing
    const gen = (manager as any).generateBranchName.bind(manager);
    const branch1 = gen('quest-abc123', 'Fix Login Bug');
    const branch2 = gen('quest-def456', 'Fix Login Bug');

    expect(branch1).toContain('quest/');
    expect(branch1).toContain('fix-login-bug');
    expect(branch1).toContain('quest-ab');
    expect(branch1).not.toBe(branch2); // different quest ids
  });

  it('branch name sanitizes special characters', () => {
    const manager = new WorktreeManager({
      repoRoot: '/tmp/repo',
      worktreeBase: '/tmp/worktrees',
    });

    const gen = (manager as any).generateBranchName.bind(manager);
    const branch = gen('q1', 'Hello World! @#$% Test');
    expect(branch).toMatch(/^quest\/[a-z0-9-]+-q1$/);
    expect(branch).not.toContain('!');
    expect(branch).not.toContain('@');
    expect(branch).not.toContain('#');
  });

  it('branch name truncates long quest names to 30 chars', () => {
    const manager = new WorktreeManager({
      repoRoot: '/tmp/repo',
      worktreeBase: '/tmp/worktrees',
    });

    const gen = (manager as any).generateBranchName.bind(manager);
    const longName = 'a'.repeat(100);
    const branch = gen('q1', longName);
    // quest/ prefix + 30 chars + - + 8 char id
    expect(branch.length).toBeLessThanOrEqual(6 + 30 + 1 + 8);
  });

  it('isBranchUsed returns false for unused branches', () => {
    const manager = new WorktreeManager({
      repoRoot: '/tmp/repo',
      worktreeBase: '/tmp/worktrees',
    });
    expect(manager.isBranchUsed('quest/some-branch')).toBe(false);
  });

  it('getActiveWorktrees returns empty initially', () => {
    const manager = new WorktreeManager({
      repoRoot: '/tmp/repo',
      worktreeBase: '/tmp/worktrees',
    });
    expect(manager.getActiveWorktrees()).toEqual([]);
  });

  it('getWorktree returns undefined for unknown quest', () => {
    const manager = new WorktreeManager({
      repoRoot: '/tmp/repo',
      worktreeBase: '/tmp/worktrees',
    });
    expect(manager.getWorktree('nonexistent')).toBeUndefined();
  });
});
