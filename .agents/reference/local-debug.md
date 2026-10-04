# Local interactive debug (TUI / headless)

Daily use with evidence: `liora --debug` (source: `pnpm -C apps/liora run dev -- --debug`). Same product, real `~/.superliora` home. Extra logs land under `~/.superliora/logs/` so a later "this broke" report has files to read. Default (no flag) stays light: warn-level session logs, no renderer trace, no stdio persist.

`test-local` is the CI-parity **test** runner. It sets `CI` and strips `TERM`/`NO_COLOR`, so it is the wrong tool for judging motion or a real session. Installed `liora.exe` (SEA) is a published cut and will not contain your checkout — use source `dev -- --debug` for unreleased TUI work.

| When | Command |
|---|---|
| Daily TUI with diagnostic logs | `liora --debug` |
| Source TUI (uncommitted checkout) | `pnpm -C apps/liora run dev -- --debug` |
| Headless run | `liora --debug -p "…"` |
| Isolated-home sandbox (optional) | `node scripts/debug-local.mjs` |

When a user reports a bug after running with `--debug`, read these before guessing:

- `~/.superliora/logs/debug-local.ndjson` — session attach / TUI start failure
- `~/.superliora/logs/tui-stdio.log` — diverted stdout/stderr (capped)
- `~/.superliora/logs/startup-trace.log` — boot stalls
- `~/.superliora/logs/liora.log` — process log (`info`: start, LLM request/response, warn/error)
- `<sessionDir>/logs/liora.log` — per-session log
- `~/.superliora/updates/rollout.log` — passive update decisions (debug only)
- `~/.superliora/logs/scroll-hang-*.json` — only when `SUPERLIORA_TUI_SCROLL_TRACE=1`

Rules:

- `--debug` keeps the operator home and login. Do not isolate `SUPERLIORA_HOME` unless they asked for `debug-local.mjs`.
- Use `writeDebugLog` from `#/utils/debug-session` for new diagnostic breadcrumbs — no ad-hoc localhost ingest, no secrets.
- Leave `SUPERLIORA_TUI_OUTPUT_TAP`, `SUPERLIORA_TUI_SCROLL_TRACE`, and `SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS` unset unless you need that exact probe — they change pixels or flood the worktree.
- A green `test-local` run does not prove motion or footer layout.

