Find files by glob, mtime newest first. Honors `.gitignore`; `include_ignored` for build outputs (secrets filtered).

Patterns: `*.ts`, `src/**/*.ts`, `**/*.py`, `*.{ts,tsx}`, `{src,test}/**/*.ts`. Cap 100 — refine if truncated. Avoid broad `node_modules/**`/`.venv/**`/`target/**`; prefer anchored subpaths.
