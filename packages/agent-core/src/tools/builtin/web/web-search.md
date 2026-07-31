Search the web for current facts via the multi-provider research engine (cost-aware cascade).

Year from latest `<current_time>` or `GetCurrentTime` for releases/CVEs/news. Default: 3 snippet hits from the cheapest ready provider; escalate only if thin. `include_content` fetches cleaned bodies for top 1–2 only (token-heavy) — prefer snippets then FetchURL on cite targets. Env keys (`BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `SERPER_API_KEY`) auto-detected; free DuckDuckGo is last-resort fallback.

Call WebSearch when pretrained knowledge may be stale (APIs, security, papers, releases) instead of asserting from memory alone.

Never-empty soft-fail: empty or failed runs return `degraded: true` instead of throwing — never halt the turn. When degraded, retry with a sharper query, browser automation (Ch4) or Chrome extension bridge (Ch5), FetchURL on a known URL, or continue from local repo evidence.
