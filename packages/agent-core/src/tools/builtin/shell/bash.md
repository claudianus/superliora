Execute a `{{ SHELL_NAME }}` command. Use this for shell semantics — pipes, env, processes, git, package managers, build/test runners, multi-step shell work.

**Prefer dedicated tools:**
- `cat`/`head`/`tail` (known path) → `Read`
- `sed`/`awk` (in-place edit) → `Edit`
- `echo > file` / heredoc → `Write`
- pattern find → `Glob` (plain `ls <dir>` OK)
- `grep`/`rg` → `Grep`
- talk to the user → text reply

Dedicated tools keep output capped and the permission UI clear.

**Output:** combined stdout/stderr; may truncate. Non-zero exit appends `Command failed with exit code: N`. For long-running foreground commands, set `timeout` in seconds. Foreground default {{ DEFAULT_TIMEOUT_S }}s, max {{ MAX_TIMEOUT_S }}s.

If `run_in_background=true`, start as a background task and return a task ID (provide short `description`). Background default {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s, max {{ MAX_BACKGROUND_TIMEOUT_S }}s; set `disable_timeout=true` only for no timeout. You are notified when the task completes. Use `TaskOutput` for a non-blocking status/output snapshot; set `block=true` only when you must wait. Use `TaskStop` only to cancel. Users inspect tasks via `/tasks`. Prefer return control to the user over blocking the conversation on a background task.

**Guidelines for safety and security:**
- Fresh shell each call — cwd/env/history not preserved. Prefer absolute paths and the `cwd` argument over cross-call `cd`.
- Do not run interactive/forever commands. Avoid `..` outside the working directory; do not modify outside paths or use superuser privileges unless instructed.

**Guidelines for efficiency:**
- Chain related commands with `&&`, `;`, `||`, pipes, redirections.
- Quote paths with spaces. Prefer one multi-step call over many tiny shells.
- Prefer `run_in_background=true` for long-running builds, tests, watchers, or servers when you need the conversation to continue before the command finishes.

**Commands available:**
Common categories usually available (confirm with `which` when unsure):
- Navigation/inspection: `ls`, `pwd`, `cd`, `stat`, `file`, `du`, `df`, `tree`
- File ops: `cp`, `mv`, `rm`, `mkdir`, `touch`, `ln`, `chmod`, `chown`
- Text/data: `wc`, `sort`, `uniq`, `cut`, `tr`, `diff`, `xargs`
- Archives: `tar`, `gzip`, `gunzip`, `zip`, `unzip`
- Network: `curl`, `wget`, `ping`, `ssh`, `scp`
- VCS/process: `git`, `ps`, `kill`, `top`, `env`, `date`, `uname`, `whoami`
- Toolchains: `node`, `npm`, `pnpm`, `yarn`, `python`, `pip` (use what the project uses)
