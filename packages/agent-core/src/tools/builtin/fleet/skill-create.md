Create or update a reusable skill (SKILL.md) from something learned in this session.

Use when a tactic, recovery pattern, or workflow proved effective and is likely to recur — e.g. a non-obvious build command, a flaky-test retry pattern, a repo-specific gotcha. Do NOT use for one-off fixes or information that belongs in Memory (facts) or AGENTS.md (project rules).

The skill is written to `.agents/skills/auto/<name>/SKILL.md` in the project root (committed-visible, reviewable by the user) and registered immediately, so SearchSkill → Skill can find it from the next call. Calling again with the same `name` updates the skill.

Write `body` as concise instructions to a future agent: when to apply, the exact steps/commands, and what to avoid. `name` must be kebab-case.
