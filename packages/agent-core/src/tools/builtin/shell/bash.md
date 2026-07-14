Execute `{{ SHELL_NAME }}` commands — pipes, env, processes, git, package managers, multi-step shell work.

**Prefer dedicated tools:**
- `cat`/`head`/`tail` → `Read`
- `sed`/`awk` edits → `Edit`
- `echo >` / heredoc → `Write`
- `find`/recursive `ls` by pattern → `Glob` (plain `ls <dir>` OK)
- `grep`/`rg` → `Grep`
- `echo`/`printf` to user → output text directly

Dedicated tools keep output capped and permission UI clear.

**Output:** combined stdout/stderr; may truncate. Non-zero exit appends `Command failed with exit code: N` when the command exits non-zero.

**Background:** `run_in_background=true` returns a task ID (requires `description`). You will be automatically notified when the task completes. Default timeout {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s, max {{ MAX_BACKGROUND_TIMEOUT_S }}s; `disable_timeout=true` only when needed. After starting, default to returning control to the user; use `TaskOutput` (`block=true` to wait). `TaskStop` to cancel. Users inspect tasks via `/tasks`.

**Guidelines for safety and security:**
- Fresh shell each call — use `cwd` or absolute paths, not prior `cd`. No interactive or forever commands; set `timeout` for long foreground work (default {{ DEFAULT_TIMEOUT_S }}s, max {{ MAX_TIMEOUT_S }}s). No `..` escape or writes outside workdir unless instructed. No sudo unless instructed.

**Guidelines for efficiency:** chain with `&&`, `;`, `||`, pipes/redirections; quote spaced paths; compose `if`/`for`/`while` in one call; background long builds/tests/servers.

**Commands available:** ls, pwd, cd, cp, mv, rm, mkdir, git, curl, tar, ps, kill, node, npm, pnpm, python, pip, etc. (confirm with `which` when unsure).
