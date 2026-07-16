Execute `{{ SHELL_NAME }}` commands — pipes, env, processes, git, package managers, multi-step shell work.

**Prefer dedicated tools:** `cat`/`head`/`tail` → `Read`; `sed`/`awk` edits → `Edit`; `echo >`/heredoc → `Write`; pattern find → `Glob` (plain `ls <dir>` OK); `grep`/`rg` → `Grep`; user messages → text reply. Dedicated tools keep output capped and the permission UI clear.

**Output:** combined stdout/stderr; may truncate. Non-zero exit appends `Command failed with exit code: N`.
