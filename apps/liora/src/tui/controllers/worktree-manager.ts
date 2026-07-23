/**
 * Worktree Manager — manages git worktree lifecycle for parallel quests.
 *
 * Each quest gets its own worktree to prevent file system conflicts
 * when multiple sessions modify the same repository simultaneously.
 *
 * AC-5: quest start → git worktree add auto-executes,
 *        cell shows worktree path, same-branch collision prevented.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { WorktreeInfo } from './quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeManagerOptions {
  /** Root repository path. */
  readonly repoRoot: string;
  /** Base directory for worktrees (e.g. ~/.superliora/worktrees/). */
  readonly worktreeBase: string;
}

// ---------------------------------------------------------------------------
// WorktreeManager
// ---------------------------------------------------------------------------

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly worktreeBase: string;
  private readonly activeWorktrees = new Map<string, WorktreeInfo>();
  private readonly usedBranches = new Set<string>();

  constructor(options: WorktreeManagerOptions) {
    this.repoRoot = options.repoRoot;
    this.worktreeBase = options.worktreeBase;
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Create a new worktree for a quest.
   * Generates a unique branch name and runs `git worktree add`.
   * Throws if the branch is already in use (collision prevention).
   */
  createWorktree(questId: string, questName: string): WorktreeInfo {
    const branch = this.generateBranchName(questId, questName);

    // Collision prevention: check if branch already used
    if (this.usedBranches.has(branch)) {
      throw new Error(
        `Worktree branch collision: "${branch}" is already in use by another quest.`,
      );
    }

    const path = join(this.worktreeBase, questId);

    // Check if path already exists
    if (existsSync(path)) {
      throw new Error(
        `Worktree path collision: "${path}" already exists.`,
      );
    }

    // Execute git worktree add
    try {
      execSync(
        `git worktree add "${path}" -b "${branch}"`,
        { cwd: this.repoRoot, stdio: 'pipe', timeout: 30_000 },
      );
    } catch (err) {
      throw new Error(
        `Failed to create worktree for quest "${questId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const info: WorktreeInfo = { questId, path, branch };
    this.activeWorktrees.set(questId, info);
    this.usedBranches.add(branch);

    return info;
  }

  // -------------------------------------------------------------------------
  // Remove
  // -------------------------------------------------------------------------

  /**
   * Remove a quest's worktree.
   * Runs `git worktree remove` and cleans up tracking.
   */
  removeWorktree(questId: string): void {
    const info = this.activeWorktrees.get(questId);
    if (!info) return;

    try {
      execSync(
        `git worktree remove "${info.path}" --force`,
        { cwd: this.repoRoot, stdio: 'pipe', timeout: 30_000 },
      );
    } catch {
      // Best-effort removal; worktree may already be gone
    }

    this.usedBranches.delete(info.branch);
    this.activeWorktrees.delete(questId);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Get worktree info for a quest. */
  getWorktree(questId: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(questId);
  }

  /** Get all active worktrees. */
  getActiveWorktrees(): readonly WorktreeInfo[] {
    return [...this.activeWorktrees.values()];
  }

  /** Check if a branch name is already in use. */
  isBranchUsed(branch: string): boolean {
    return this.usedBranches.has(branch);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Generate a unique branch name from quest id and name. */
  private generateBranchName(questId: string, questName: string): string {
    const sanitized = questName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    const shortId = questId.slice(0, 8);
    return `quest/${sanitized}-${shortId}`;
  }
}
