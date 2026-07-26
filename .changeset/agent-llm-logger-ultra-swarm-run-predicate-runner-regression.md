---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/{llm-request-logger, ultra-swarm-run, goal/predicate-runner pure helpers} regression cases

- `splitGenerateOptions` — pin the all-undefined return shape for `undefined` input, the strip of `requestLogFields` / `runtimeModelAlias` / `runtimeCredentialLabel` into separate fields while keeping the rest of the options intact, and the `undefined` placeholders when none of those fields are present.
- `isRestaffSteerText` — pin the empty / whitespace `false` return, the case-insensitive `UltraSwarm restaff requested` directive, the `restaff requested from war room` form, the leading `restaff:` and `/swarm restaff` prefixes, the bare leading `restaff` token, the mid-text `request(ed)? restaff` matches, and the rejection of unrelated prose.
- `countEvidenceIds` — pin the null / no-workGraph `0` return, the sum of `evidenceIds` across all nodes, and the missing-evidenceIds-as-zero behaviour.
- `resolveWithinRoot` — pin the relative-path-under-root resolution, the absolute-but-inside-root normalised path, the `..` escape `null` return, and the absolute-outside-root `null` return.
- `isAllowedTestFile` — pin the `.test.ts` / `.spec.mjs` acceptance, the nested `test/` directory acceptance (extension independent), the outside-root rejection, and the regular `.ts` outside-any-test-directory rejection.
- `formatPredicateFailures` — pin the empty-list empty-string return and the `- [code] message` newline-joined rendering.
