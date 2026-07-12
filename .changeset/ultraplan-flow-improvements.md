---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Improve UltraPlan interview robustness and visibility

- Exposes the auto-answer origin counter (`Auto-answers so far: N/3`) in the interview readiness guide so users see when consecutive non-user answers are accumulating before the Rhythm Guard triggers.
- Adds a deterministic heuristic fallback for ambiguity scoring when the LLM engine is unavailable or returns invalid JSON, with an automatic one-time retry and a user-facing AskUserQuestion option in the readiness guide.
- Adds a Seed 5-section coverage guard after UltraPlan drift validation to refuse exiting plan mode when Goal, Constraints, Acceptance, Ontology, or Evaluation sections are missing from the plan.
- Adds bidirectional knowledge provenance links between the project-local LLM Wiki index and the per-run Liora Knowledge Map.
- Adds three regression tests covering origin counter visibility, LLM-failure heuristic fallback, and Seed section coverage.
