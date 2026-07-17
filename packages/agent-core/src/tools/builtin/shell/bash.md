Execute a `{{ SHELL_NAME }}` command for shell semantics — pipes, env, processes, git, package managers, build/test runners, multi-step shell work.

**Prefer dedicated tools:**
- known path read → `Read` (not `cat`/`head`/`tail`)
- in-place edit → `Edit` (not `sed`/`awk`)
- create/overwrite file → `Write` (not `echo >` / heredoc)
- name search → `Glob` (`ls <dir>` OK)
- content search → `Grep` (not `grep`/`rg`)
- talk to the user → text reply

Dedicated tools keep output capped and the permission UI clear.

**Output:** combined stdout/stderr; may truncate. Non-zero exit appends `Command failed with exit code: N`. Long foreground work: set `timeout` seconds (default {{ DEFAULT_TIMEOUT_S }}s, max {{ MAX_TIMEOUT_S }}s).

**Background:** `run_in_background=true` returns a task ID (short `description` required). Background default {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s, max {{ MAX_BACKGROUND_TIMEOUT_S }}s; `disable_timeout=true` only when unbounded. You are notified when the task completes. Use `TaskOutput` for a non-blocking status/output snapshot; set `block=true` only when you must wait. Use `TaskStop` only to cancel. Users inspect tasks via `/tasks`. Prefer return control to the user over blocking the conversation on a background task.

**Safety:** Fresh shell each call — cwd/env/history not preserved. Prefer absolute paths and the `cwd` argument over cross-call `cd`. No interactive/forever commands. Avoid `..` outside the workspace; no superuser unless instructed.

**Efficiency:** Chain with `&&`, `;`, `||`, pipes, redirections. Quote paths with spaces. Prefer one multi-step call over many tiny shells. Prefer `run_in_background=true` for long builds, tests, watchers, or servers when the conversation should continue.

**Commands available:** Common bins only (confirm with `which` when unsure). Do not invent exotic tools; prefer the dedicated tools above for file/search work.
