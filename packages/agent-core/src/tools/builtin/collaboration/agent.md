Launch a subagent — same-process loop, own context. Delegating keeps intermediate file contents out of your context; you get a conclusion, not raw dumps.

**Prompting:** subagent starts with zero context. State goal, known facts, exact paths/commands; prefer questions over prescribed steps for investigations. Unless web is forbidden, tell it to use Context7Resolve/Context7Docs for library APIs and WebSearch/FetchURL for papers, CVEs, primary sources, or open-source implementations that could affect the answer. Do not delegate understanding of critical paths.

**Notes:** prefer resume (`resume` id) over respawn; results only visible to you — summarize for the user; fixed 30-minute timeout — resume on timeout. Once running, do not redo its work or finish manually.

**When NOT to use:** trivial one–two step work you can do directly — handoff cost is not worth it.
