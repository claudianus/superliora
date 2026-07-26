Execute a `{{ SHELL_NAME }}` command for shell semantics — pipes, env, processes, git, package managers, build/test runners, multi-step shell work.

**Prefer dedicated tools:**
- `cat`/`head`/`tail`/`gcat`/`bat`/`batcat`/`type`/`Get-Content`/`Get-Item`/`glow`/`mdcat`/`rich`/`less`/`more`/`most`/`w3m`/`lynx` (local path) → `Read`
- `sed`/`gsed`/`awk`/`perl -i`/`ruby -i` (in-place edit) → `Edit`
- `echo > file` / heredoc / `sponge` / empty redirect → `Write`
- simple `cp`/`install`/`rsync`/`dd if= of=` workspace copies → `Read`+`Write`
- pattern find / `fd`/`fdfind` / `rg --files` / `mdfind`/`locate` / `compgen -G` / `tree` / `ls -R` / `Get-ChildItem -Recurse` / `Get-ChildItem -Name` / `dir /s` / `where /r` → `Glob` (plain `ls`/`dir`/`gci` of a directory OK)
- `grep`/`rg` (content) / `ag`/`ack`/`ugrep` / `git grep` / `Select-String`/`findstr` → `Grep`
- `jq`/`yq`/`python -m json.tool`/`ConvertTo-Json`/`Select-Object` (path dumps) whole-file dumps → `Read`
- `git show <rev>:<path>` / `svn cat` / `hg cat` → `Read` (commit summaries stay OK)
- talk to the user → text reply

Dedicated tools keep output capped and the permission UI clear.

**Output:** combined stdout/stderr; may truncate. Non-zero exit appends `Command failed with exit code: N`. For long-running foreground commands, set `timeout` in seconds. Foreground default {{ DEFAULT_TIMEOUT_S }}s, max {{ MAX_TIMEOUT_S }}s.

If `run_in_background=true`, start as a background task and return a task ID (provide short `description`). Background default {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s, max {{ MAX_BACKGROUND_TIMEOUT_S }}s; set `disable_timeout=true` only for no timeout. You are notified when the task completes. Use `TaskOutput` for a non-blocking status/output snapshot; set `block=true` only when you must wait. Use `TaskStop` only to cancel. Users inspect tasks via `/tasks`. Prefer return control to the user over blocking the conversation on a background task.

**Safety:** Fresh shell each call — cwd/env/history not preserved. Prefer absolute paths and the `cwd` argument over cross-call `cd`. Do not run interactive/forever commands. Avoid `..` outside the working directory; do not modify outside paths or use superuser privileges unless instructed.

**Efficiency:** Chain with `&&`, `;`, `||`, pipes, redirections. Quote paths with spaces. Prefer one multi-step call over many tiny shells. Prefer `run_in_background=true` for long builds, tests, watchers, or servers when the conversation should continue.

**Commands available:** Common bins (confirm with `which`): `ls` `pwd` `cd` `stat` `file` `du` `df` `tree` `cp` `mv` `rm` `mkdir` `touch` `ln` `chmod` `chown` `wc` `sort` `uniq` `cut` `tr` `diff` `xargs` `tar` `gzip` `gunzip` `zip` `unzip` `curl` `wget` `ping` `ssh` `scp` `git` `ps` `kill` `top` `env` `date` `uname` `whoami` `node` `npm` `pnpm` `yarn` `python` `pip`.

Simple whole-command file I/O shapes are **rejected** at runtime — use dedicated tools:
- reads: `cat`/`gcat`/`head`/`ghead`/`tail`/`bat`/`batcat`/`type`/`Get-Content`/`Get-Item` (file path dumps)/`ConvertTo-Json` (path dumps)/`Select-Object` (path dumps)/`Format-List`/`Format-Table`/`Out-String` (path dumps)/`glow`/`mdcat`/`rich`/`python -m rich.syntax`/`less`/`more`/`most`/`nl`/`w3m`/`lynx`/`elinks` (local path)/`zcat`/`gzcat`/`bzcat`/`xzcat`/`zstdcat`/`rev`/`paste` (single file)/`sort`/`uniq`/`shuf` (single file)/`look word file`/`iconv … file`/`sed -n`/`awk`/`base64`/`hexdump`/`fmt`/`pr`/`fold`/`jq`/`yq`/`python -m json.tool`/`git show <rev>:<path>`/`svn cat`/`hg cat`/`pbcopy < path`/`Set-Clipboard -Path`/`xclip path`/`xsel path`
- edits: `sed -i`/`gsed`/`perl -pi`/`ruby -i`/`busybox sed -i`
- writes/copies: redirects, heredocs, `sponge`, empty redirect, `truncate -s 0`, `dd if= of=`, `install src dest`, simple `cp`/`rsync` (two local paths; recursive/`-a` stays allowed), `pbpaste > path`, `Get-Clipboard > path`/`Get-Clipboard | Set-Content`, PowerShell `Set-Content`/`Out-File`/`Add-Content`/`Clear-Content`/`New-Item -ItemType File`/`Copy-Item` (simple two-path; `-Recurse` stays allowed)
- language one-liners: `python`/`node`/`ruby`/`php`/`perl`/`lua` file reads **and writes**
- search/list: `grep`/`rg`/`rg --files`/`ag`/`ack`/`ugrep`/`git grep`/`git ls-files`/`find`/`fd`/`fdfind`/`mdfind`/`locate`/`compgen -G`/`tree`/`ls -R`/`Select-String`/`findstr`/`Get-ChildItem -Recurse`/`Get-ChildItem -Name`/`dir /s`/`where /r`
Leading process wrappers (`command`/`timeout`/`stdbuf`/`nice`/`nohup`/`env`/`\cmd`/`powershell -Command`/`pwsh -c`/`cmd /c`) are stripped before detection. Pipelines, `&&` lists, and real process work stay allowed.

Escape hatch: prefix with `LIORA_FORCE_BASH=1 ` only when shell semantics are truly required (does **not** override sensitive-path hard blocks).

Commands that reference sensitive paths (`.env*`/`secrets.env`, SSH keys, cloud credentials, `.npmrc`/`.pypirc`/`.netrc`/`.pgpass`/`kubeconfig`/`.git-credentials`/`token.json`/`secrets.*`, `~/.ssh/`, `~/.gnupg/`, `~/.composer/auth.json`, `~/.config/gh/hosts.yml`, `~/.azure/accessTokens.json`, `~/.pulumi/credentials.json`) are **hard-blocked** with no force escape — same policy as Read/Write/Edit.
