Unified repository search. Prefer RepoQuery over separate Grep/Glob when exploring unknown code.

Modes:
- `content` — regex search (delegates to ripgrep; use `context_lines` for surrounding lines)
- `path` — glob file discovery (mtime newest first)
- `symbol` — definition/reference lookup (warm when codemap index is ready)
- `outline` — top-level declarations for one file (`path` required)

Always returns structured output with `index_status`, `took_ms`, and `truncated`. Warm symbol/content hits also include `derived_links`; pass those edges to `Memory.remember.links` when saving a durable fact. On cold index, follow `next_step` hints (Grep/Read).
