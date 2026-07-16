Find files by glob, sorted by mtime (newest first). Respects `.gitignore`; `include_ignored` for build outputs (secrets filtered).

Patterns: `*.ts`, `src/**/*.ts`, `**/*.py`, `*.{ts,tsx}` (brace expansion), `{src,test}/**/*.ts`. Cap 100 — refine if truncated. Avoid broad `node_modules/**`/`.venv/**`/`target/**`; prefer anchored subpaths.
