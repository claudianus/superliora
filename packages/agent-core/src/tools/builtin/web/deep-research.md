Multi-hop web research over the same provider cascade as WebSearch — plans 2–5 queries, fans out in parallel, dedupes and ranks sources, and returns a structured brief (outline, provisional claims, citations).

Use for questions that need several angles or corroboration instead of a single WebSearch call. Prefer WebSearch for one sharp lookup; use DeepResearch when breadth or freshness matters. `freshness` narrows recency (`day`/`week`/`month`/`year`); `depth` controls per-query hit limits (`quick`/`standard`/`exhaustive`).

Never-empty soft-fail: empty or failed runs return `degraded: true` instead of throwing — never halt the turn. When degraded, retry with a simpler question, WebSearch, browser automation (Ch4) or Chrome extension bridge (Ch5), FetchURL on a known URL, or continue from local repo evidence.
