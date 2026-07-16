Search file contents with ripgrep regex. Use for unknown content or unknown file locations — not when you have a concrete path (use `Read`). ALWAYS use Grep instead of shell `grep`/`rg`.

Ripgrep syntax (not POSIX) — escape `\{` for literal braces. hidden/dotfiles searched by default. `include_ignored=true` for `.gitignore` paths (e.g. `node_modules`); sensitive files (`.env`) always skipped.
