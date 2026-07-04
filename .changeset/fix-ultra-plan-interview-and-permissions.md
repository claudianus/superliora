---
"@superliora/agent-core": patch
---

Fix infinite ultra-plan interview loops and phase permission inconsistencies.

Interview gate stability:
- Cache LLM ambiguity results keyed by evidence hash so repeated calls with
  the same interview answers return the same score instead of oscillating.
- Add monotonic-ready lock: once the gate reports ready, it stays ready
  until a new interview round changes the evidence — LLM non-determinism
  cannot un-ready an already-passed gate.
- Add MAX_INTERVIEW_ROUNDS (8) safety cap that force-advances to Design
  even if the LLM keeps producing borderline scores.

Phase permission consistency:
- Replace per-phase hardcoded tool whitelists with a central
  READ_ONLY_TOOL_NAMES set. Read-only tools (Read, ReadMediaFile, Grep,
  Glob, LioraContext, WebSearch, FetchURL, SearchSkill, Skill,
  SearchExpert, TodoList, TaskList, TaskOutput) are now automatically
  allowed in every read-only phase (research, design, review).
- This fixes the previous inconsistency where ReadMediaFile and
  LioraContext were allowed in research/review but blocked in design.
- New read-only tools added to the codebase only need to be registered in
  one place (READ_ONLY_TOOL_NAMES) to be permitted across all read-only
  phases.
