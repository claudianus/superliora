Create or update a reusable skill (SKILL.md) from a lesson in this session. Registered immediately — SearchSkill → Skill works in this session without restart.

Use when a tactic, recovery, or inferred constraint is likely to recur: a non-obvious command, a flake workaround, a repo-specific gotcha discovered by failing first. Do NOT use for one-off fixes, Memory facts, or AGENTS.md project rules.

SearchSkill first; reuse `name` to update. `name` is kebab-case.

Write for a future agent AND for SearchSkill:
- `description` / `whenToUse` / `triggers`: 3–12 English keywords a later SearchSkill query would use (task, domain, error, tool).
- `body`: numbered steps with the exact commands/paths that worked, a `Done when …` line, and what not to do. No generic "try again".
