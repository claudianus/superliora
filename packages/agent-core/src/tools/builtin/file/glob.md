Find files by glob, sorted by mtime (newest first). Respects `.gitignore`; `include_ignored` for build outputs (secrets filtered).

Good patterns: `*.ts`, `src/*.ts`, `src/**/*.ts`, `**/*.py`, `*.{ts,tsx}` (brace expansion), `{src,test}/**/*.ts`. Capped at 100 — refine when truncated.

Avoid broad `node_modules/**`/`.venv/**`/`target/**`; prefer anchored subpaths (e.g. `node_modules/react/src/**/*.js`).
