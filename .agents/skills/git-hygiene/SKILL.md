---
name: git-hygiene
description: >
  SuperLiora git/worktree hygiene. Use when cleaning stale worktrees, orphan
  liora/* branches, conductor leftovers, stashes, or merged remote branches;
  when the user says "git hygiene", "worktree cleanup", "prune worktrees",
  "stale branches", or after parallel agent / conductor runs leave debris.
---

# Git hygiene (SuperLiora harness)

SSOT for session isolation is `~/.superliora/worktrees` + `liora worktree …`.
Do **not** invent a parallel `.worktrees/` layout or `rm -rf` registry paths.

## Isolate first

Large, risky, or parallel work → dedicated worktree:

```bash
liora --worktree [name]
# or
liora worktree list
```

Small reversible edits may stay on the shared checkout.

## Clean with the CLI

```bash
liora worktree hygiene --dry-run
liora worktree hygiene
```

What it does:

1. `git worktree prune` + drop missing registry rows
2. Age-GC registered session worktrees (default 14 days)
3. Delete orphan local `liora/*` branches (no registry entry)
   - Merged tips → delete
   - Unmerged tips → annotated tag `archive/tips/<slug>`, then delete
4. Optional: `--stale-remotes` deletes remote heads already in `origin/main` (never `main`)

Flags:

| Flag | Meaning |
|------|---------|
| `--dry-run` | Plan only |
| `--max-age-days N` | GC age (default 14) |
| `--no-archive` | Skip archive tags (do **not** use unless tips are disposable) |
| `--stale-remotes` | Also delete merged remote branches |
| `--repo` | Require current cwd to be a git repo |

Also available: `liora worktree list|rm|gc`.

## Agent rules

1. Prefer `liora worktree …` over raw `git worktree add` under `~/.superliora/worktrees`.
2. End of a multi-agent / conductor sweep → run hygiene `--dry-run`, then apply.
3. Unique WIP: move stash to `archive/stash-*` branch, or rely on hygiene archive tags.
4. Never force-delete unique tips without an archive tag (or explicit operator OK).
5. Use `--stale-remotes` only after confirming PRs are merged.
6. Do not `rm -rf` under `~/.superliora/worktrees`.

## Recovery

```bash
git switch -c revive/foo archive/tips/liora-conductor-…
git switch archive/stash-wip-agent-core   # if present
```

## Policy pointer

Repo hot-path: root `AGENTS.md` (worktree isolation + hygiene cadence).
