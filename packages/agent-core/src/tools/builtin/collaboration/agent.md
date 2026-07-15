Launch a subagent (same-process loop, own context). You get a conclusion, not intermediate dumps.

**Prompting:** subagent starts with zero context. Give goal, known facts, exact paths/commands; prefer questions over prescribed steps for investigations. Unless web is forbidden, tell it to use Context7Resolve/Context7Docs for library APIs and WebSearch/FetchURL for papers, CVEs, and other primary sources when current best practices could affect the answer. Do not delegate understanding of critical paths.

**Notes:** prefer resume (`resume` id) over respawn; results are only visible to you — summarize for the user; 30-minute timeout — resume on timeout. Once running, do not redo its work or finish manually.

**When NOT to use:** trivial one–two step work you can do directly.