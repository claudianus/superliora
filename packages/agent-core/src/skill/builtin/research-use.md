---
name: research-use
description: >
  SuperLiora research harness — WebSearch, FetchURL, Context7Resolve→Context7Docs.
  Use for freshness-sensitive facts, library APIs, CVEs, releases, and papers.
  Do NOT load catalog web-search / tavily / serpapi / brave / context7 script
  skills while these tools exist. Skill("research-use") for the playbook.
whenToUse: >
  Web search, library API docs, Context7, FetchURL, latest release, CVE lookup —
  before installing Tavily/SerpAPI/Brave/DuckDuckGo catalog scripts.
---

# SuperLiora research-use (builtin)

Hard rule: use **session research tools**. Ignore catalog skills named `web-search`,
`context7`, `tavily`, `serpapi`, `web-search-plus`, etc. that shell out to vendor APIs.

## Happy path

1. Library/docs: `Context7Resolve` → `Context7Docs` when those tools exist.
2. News / CVE / releases / papers: `WebSearch`, then `FetchURL` on the 1–2 URLs you will cite.
3. Dates: `<current_time>` / `GetCurrentTime` — never invent "today".
4. Snippets are not proof — fetch primary sources when the recommendation hinges on them.

## Do not

- `npm i` / `bun` / `node scripts/search.mjs` from catalog search skills.
- Treat catalog Skill("web-search") or Skill("context7") as the harness tools.
- Skip research out of habit when facts may be stale.
