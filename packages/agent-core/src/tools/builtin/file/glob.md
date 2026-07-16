Find files by glob, sorted by mtime (newest first). Respects `.gitignore`; `include_ignored` for build outputs (secrets filtered).

Patterns: `*.ts`, `src/**/*.ts`, `**/*.py`, `*.{ts,tsx}`, `{src,test}/**/*.ts`. Cap 100 — refine when truncated. Avoid broad `node_modules/**`/`.venv/**`/`target/**`; prefer anchored subpaths.
