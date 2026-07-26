---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/{perspective, interview-rounds, evaluation} regression cases

- `INTERVIEW_PERSPECTIVE_DESCRIPTIONS` / `getInterviewPerspectiveDescription` — pin the five-perspective coverage (researcher, simplifier, architect, breadth-keeper, seed-closer), the "researcher" copy mentioning benchmarks, the "seed-closer" copy mentioning measurable criteria, and the record-lookup equality.
- `formatInterviewAnswerText` — pin the `key: value` join with the literal `true` rendering, and the empty-input empty-string return.
- `formatInterviewQuestionText` — pin the question-only path when no header is supplied, the `header: question` path for non-empty headers, and the question-only path for empty headers.
- `appendInterviewRoundState` — pin the user-origin reset of `consecutiveNonUserAnswers`, the non-user-origin increment, the 1-based round numbering, the LLM-cache invalidation and monotonic-ready unlock on every new round, and the default-origin (`user`) + default-timestamp (`Date.now()`) fallbacks.
- `buildDefaultEvaluationPlan` — pin the default Evaluation Plan (stage1 + stage2 on, stage3 off, the five mechanical checks, and the three semantic criteria) and the fresh-object-per-call guarantee.
