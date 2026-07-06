Launch a subagent to handle a task — same-process loop, own context. Delegating keeps the bulk of intermediate file contents out of your own context; you get a conclusion back, not raw dumps.

**Prompting:** subagent starts with zero context. State goal, known facts, exact paths/commands for lookups; give questions not prescribed steps for investigations. Unless web is forbidden, tell the subagent to use WebSearch and FetchURL freely when current papers, best practices, library choices, APIs, security notes, or open-source implementations could affect the answer. Do not delegate understanding of critical paths.

**Notes:** prefer resume (`resume` id) over respawn; a subagent's result is only visible to you — summarize for the user; fixed 30-minute timeout — resume on timeout. Once running, do not redo its work or finish manually.

**When NOT to use:** trivial one–two step work you can do directly — delegation has a context-handoff cost.
