---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/goal/predicate.ts and agent/skill/prompt.ts regression cases

- `agent/goal/predicate.ts` — pins `parseGoalPredicateCriterion` for the `empty` branch (undefined / whitespace), the `structured` branch (case-insensitive `GOAL-PREDICATE` fence, `json` fence, `predicate:v1:` inline prefix, raw `{...}` JSON, version matching against `GOAL_PREDICATE_VERSION`), the `legacy` branch (free-form prose, embedded JSON with non-matching version), the trim + non-string filter for `requiredPaths` / `requiredTestFiles` string arrays, the `Math.floor` + negative-clamp for `minEvidenceIds`, and the `requireUltraworkGraph` boolean-only normalization.
- `agent/skill/prompt.ts` — pins `renderUserSlashSkillPrompt` (user-slash trigger text + `<kimi-skill-loaded>` envelope + `args=` attribute), `renderModelToolSkillPrompt` (`model-tool` and `nested-skill` trigger rendering), and `renderSkillLoadedBlock` (name / trigger / args envelope, optional `source` / `dir` attributes, attribute-value XML-escape, empty args passthrough).
