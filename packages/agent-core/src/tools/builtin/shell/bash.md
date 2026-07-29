Execute a `{{ SHELL_NAME }}` command for shell semantics — pipes, env, processes, git, package managers, build/test runners, multi-step shell work.

**Prefer dedicated tools:**
- File reads (`cat`/`head`/`tail`/`bat`/`less`/`git show <rev>:<path>`) → `Read`
- In-place edits (`sed -i`/`perl -i`) → `Edit`
- File creation/overwrite (redirects, heredocs, `sponge`) → `Write`
- Pattern find (`fd`/`rg --files`/`find`/`tree`/`ls -R`) → `Glob`
- Content search (`grep`/`rg`/`ag`/`git grep`) → `Grep`
- Talk to the user → text reply

Dedicated tools keep output capped and the permission UI clear.

**Output:** combined stdout/stderr; may truncate. Non-zero exit appends `Command failed with exit code: N`. For long-running foreground commands, set `timeout` in seconds. Foreground default {{ DEFAULT_TIMEOUT_S }}s, max {{ MAX_TIMEOUT_S }}s.

If `run_in_background=true`, start as a background task and return a task ID (provide short `description`). Background default {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s, max {{ MAX_BACKGROUND_TIMEOUT_S }}s; set `disable_timeout=true` only for no timeout. You are notified when the task completes. Use `TaskOutput` for a non-blocking status/output snapshot; set `block=true` only when you must wait. Use `TaskStop` only to cancel. Users inspect tasks via `/tasks`. Prefer return control to the user over blocking the conversation on a background task.

**Safety:** Fresh shell each call — cwd/env/history not preserved. Prefer absolute paths and the `cwd` argument over cross-call `cd`. Do not run interactive/forever commands. Avoid `..` outside the working directory; do not modify outside paths or use superuser privileges unless instructed.

**Efficiency:** Chain with `&&`, `;`, `||`, pipes, redirections. Quote paths with spaces. Prefer one multi-step call over many tiny shells. Prefer `run_in_background=true` for long builds, tests, watchers, or servers when the conversation should continue.

**Commands available:** Common bins (confirm with `which`): `ls` `pwd` `cd` `stat` `file` `du` `df` `tree` `cp` `mv` `rm` `mkdir` `touch` `ln` `chmod` `chown` `wc` `sort` `uniq` `cut` `tr` `diff` `xargs` `tar` `gzip` `gunzip` `zip` `unzip` `curl` `wget` `ping` `ssh` `scp` `git` `ps` `kill` `top` `env` `date` `uname` `whoami` `node` `npm` `pnpm` `yarn` `python` `pip`.

**Rejected at runtime** (use dedicated tools): whole-file reads, in-place edits, file writes/creates via redirects/heredocs, and content search commands are blocked when they reduce to a single dedicated-tool operation. Pipelines, `&&` lists, and real process work stay allowed. Leading wrappers (`command`/`timeout`/`env`/`nohup`/`powershell -Command`) are stripped before detection.

Escape hatch: prefix with `LIORA_FORCE_BASH=1 ` only when shell semantics are truly required (does **not** override sensitive-path hard blocks).

Commands referencing sensitive paths (`.env*`, SSH keys, cloud credentials, `.npmrc`/`.pypirc`/`.netrc`/`.pgpass`/`kubeconfig`/`.git-credentials`, `~/.ssh/`, `~/.gnupg/`) are **hard-blocked** with no force escape.
