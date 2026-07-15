Execute `{{ SHELL_NAME }}` commands (pipes, env, git, package managers, multi-step shell).

**Prefer dedicated tools:** `Read`/`Edit`/`Write` over `cat`/`sed`/`echo >`; `Glob` over recursive `find`; `Grep` over `rg`/`grep`. Dedicated tools keep output capped and permission UI clear.

**Output:** combined stdout/stderr (may truncate). Non-zero exits append `Command failed with exit code: N`.

**Background:** `run_in_background=true` returns a task ID (needs `description`). Default timeout {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s, max {{ MAX_BACKGROUND_TIMEOUT_S }}s; `disable_timeout=true` only when needed. Use `TaskOutput` / `TaskStop`; users inspect via `/tasks`.

**Safety:** fresh shell each call—use `cwd` or absolute paths, not prior `cd`. No interactive/forever commands. Foreground timeout default {{ DEFAULT_TIMEOUT_S }}s (max {{ MAX_TIMEOUT_S }}s). No `..` escapes or writes outside workdir/sudo unless instructed.

**Efficiency:** chain with `&&`/`;`/`||`/pipes; quote spaced paths; one call for loops/conditionals.