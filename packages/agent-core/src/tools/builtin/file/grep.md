Search file contents with ripgrep regex. Use for unknown content or unknown file locations — not when you have a concrete path (use `Read`). ALWAYS use Grep tool instead of running `grep` or `rg` from a shell. Do not use shell `grep` or `rg` directly.

Ripgrep syntax (not POSIX) — escape `\{` for literal braces. Hidden files (dotfiles such as `.gitlab-ci.yml`) are searched by default. `include_ignored=true` searches `.gitignore` paths (e.g. `node_modules`); sensitive files (such as `.env`) are always skipped.
