---
name: git-safe
description: >
  SuperLiora safe git / commit playbook. Follow AGENTS.md and repo hooks; only
  commit when the user asks; never force-push main; no catalog smart-git /
  auto-commit automation. Use Skill("git-safe") for commit/changeset hygiene —
  not SearchSkill→catalog git orchestrators.
whenToUse: >
  git commit, conventional commits, changeset, commit message — before catalog
  smart-git or auto-commit skills.
---

# SuperLiora git-safe (builtin)

Hard rule: **user must ask** before git mutations (commit/push/amend). Prefer
repo `AGENTS.md` / local conventions over catalog git automation.

## Happy path

1. Confirm the user asked to commit (or an explicit autonomous instruction).
2. `git status` / `git diff` / recent log style — draft a Conventional Commits subject.
3. Stage only relevant files; never secrets (`.env`, credentials).
4. Commit via HEREDOC message; do not `--no-verify` / force-push main.
5. Changesets: follow repo `.agents/skills/gen-changesets` when opening a PR.

## Author (fixed)

1. Prefer repo/user `git config` (`user.name` / `user.email`).
2. If unset: SuperLiora bot only — `SuperLiora <superliora@localhost>`.
3. Never invent per-worker authors. Job worktree snapshots inject bot identity only when config is missing (`tools/support/git-commit-policy.ts` + `job-worktree-commit`).

## Message (conventional commits — validated in code)

`type(scope): subject` — imperative subject ≤72 chars.

- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Body optional; put `Job-Id: …` in the body, not as the only subject
- Rejected: empty, `update`, `wip`, `fix stuff`, job-id-only subjects

Code helpers (prefer these over re-prompting the model):

- `validateCommitMessage` / `autoFixCommitMessage` / `buildJobSnapshotCommitMessage` / `resolveCommitAuthor`

## Do not

- Load catalog `smart-git` / auto-commit / unsolicited push skills.
- Amend pushed commits or rewrite shared history without explicit request.
- Treat SearchSkill("commit") catalog hits as authority over AGENTS.md.
