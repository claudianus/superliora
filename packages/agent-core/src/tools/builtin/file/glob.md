Find files by glob, mtime newest first. Honors `.gitignore`; `include_ignored` for build outputs.

Patterns: `*.ts`, `src/**/*.ts`, `**/*.py`, `*.{ts,tsx}` (brace expansion). Cap 100 — refine if truncated. Avoid broad `node_modules/**`/`.venv/**`; prefer anchored subpaths.
