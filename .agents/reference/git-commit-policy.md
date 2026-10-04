# Git commit policy (author + message)

Agent and job commits use one policy, enforced in code by
`packages/agent-core/src/tools/support/git-commit-policy.ts` (job worktree
snapshots go through the same helper).

### Author

1. Prefer repository / user `git config` (`user.name` + `user.email`).
2. If either is missing, use only the documented SuperLiora bot identity:
   - name: `SuperLiora`
   - email: `superliora@localhost`
3. Do not invent per-worker names or emails, and do not rotate identity across jobs.
4. Keep `Co-authored-by:` trailers when a human co-author policy applies; never replace the primary author with a worker label.

### Message (conventional commits)

Format: `type(scope): subject`

- **type**: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
- **scope**: optional (`tui`, `agent-core`, `job`, …)
- **subject**: imperative mood, ≤72 characters, no trailing period
- **body** (optional): blank line after subject; explain why / what changed
- **Job id**: may appear in the body (`Job-Id: job_…`), never as the sole subject

**Reject / rewrite** empty subjects and vague ones: `update`, `wip`, `fix stuff`,
`misc`, bare `fix`/`test`, or a subject that is only a job id.

Helpers: `validateCommitMessage`, `autoFixCommitMessage`,
`buildJobSnapshotCommitMessage`, `resolveCommitAuthor`.

