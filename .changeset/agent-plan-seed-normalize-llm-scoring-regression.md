---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/{seed-normalize, llm-scoring, score-result} regression cases

- `normalizeOntology` — pins default-name / default-description fallback, trim of name + description, fully-typed field filter (drops entries missing any of name/type/description/required), and the empty-fields default when `raw.fields` is not an array.
- `normalizeSeedSpec` — pins the full happy-path shape (trim goal, validated `taskType`, string-only constraints, `ac_N` acceptance-criteria IDs, ontology field pass-through, fully-typed evaluation-principle filter, fully-typed exit-condition filter, raw `ambiguityScore` override), the default taskType / fallback-goal / default principle / default exit-condition paths, and the `ambiguityScore` override of `buildSeedSpec` when the LLM provides one.
- `buildSeedSpecExtractionUserPrompt` / `buildDriftEvaluationUserPrompt` — pin the JSON schema embedding, the evidence body passthrough, the seedSpec serialisation, and the `'none'` placeholder for empty constraint-violation lists.
- `parseAmbiguityLlmResult` — pin the null-input null-output, the 0..1 clamp on every clarity / specificity score, the stringification of `present_sections`, the `verifiable_goal` boolean guard, and the empty-justification defaults.
- `parseDriftLlmResult` — pin the null-input null-output, the 0..1 clamp on each drift field, and the 0 default for missing fields.
- `buildAmbiguityScoreResult` — pin the ready milestone with all sections present and verifiable goal, the monotonic `hardReady` lock carried over the next call, the non-bumping of the completion-candidate streak when the round + evidence are unchanged, and the `usedHeuristicFallback` propagation.
- `openSeedGapsFromLlmResult` — pin the all-sections fallback for null / undefined input and the drop of present sections from the gap list.
