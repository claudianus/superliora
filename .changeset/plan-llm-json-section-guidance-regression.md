---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/ultra-plan-llm-json.ts and ultra-plan-section-guidance.ts regression cases

- `ultra-plan-llm-json.ts` — pins `extractTextFromLLMResponse` (first text part selection, malformed-response empty fallback), `extractJsonFromText` (` ```json ` and bare ` ``` ` fence stripping, first `{...}` fallback, no-brace `null` return, broken brace-order `null` return), and `parseJsonFromLLMResponse` (clean parse, malformed JSON → `null`, no JSON → `null`).
- `ultra-plan-section-guidance.ts` — pins the documented 10-section `ULTRA_PLAN_REQUIRED_SECTIONS` (goal / actors / inputs / outputs / constraints / non_goals / acceptance_criteria / verification_plan / failure_modes / runtime_context in order), `MAX_INTERVIEW_ROUNDS = 8` soft cap, the per-section `ULTRA_PLAN_SECTION_GUIDANCE` (label + `askHint` non-empty for every required section, human-readable label mapping for `Acceptance Criteria` / `Verification Plan` / `Failure Modes`).
