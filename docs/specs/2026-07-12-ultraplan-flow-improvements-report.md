# UltraPlan Workflow Improvements Report

Date: 2026-07-12
Scope: `packages/agent-core` UltraPlan interview, scoring fallback, and plan-exit validation

## Problems Diagnosed

Three recurring issues were observed in the UltraPlan workflow:

1. **Overly technical / mechanical interview questions.** The Rhythm Guard already tracked `consecutiveNonUserAnswers`, but the counter was only surfaced when it reached 3 and forced a user question. Users had no early visibility into how many consecutive code/research answers had been recorded.
2. **Auto-answer fallback not working.** When `_calculateAmbiguityWithLLM` returned `null` (LLM unavailable or invalid JSON), `calculateAmbiguityScore` threw an error and blocked the interview. There was no automatic retry or safe deterministic fallback.
3. **Missing required sections in the final plan.** Even when drift validation passed, the final plan could still omit one of the five Seed Spec sections (Goal, Constraints, Acceptance, Ontology, Evaluation) and exit successfully.

## Applied Fixes

### AC-1 — Origin counter visibility

- `formatInterviewReadinessGuide` already contained a branch that prints `Auto-answers so far: N/3` when the counter is 1 or 2.
- The callers in `packages/agent-core/src/agent/injection/plan-mode.ts` were not passing `consecutiveNonUserAnswers`, so the copy was never shown.
- Updated both `buildPhaseReminder` and `buildPhaseSparseReminder` to pass `engine.interviewState.consecutiveNonUserAnswers`.

### AC-2 — LLM failure safe path

- Added `usedHeuristicFallback?: boolean` to `AmbiguityScoreResult`.
- Added a private `computeAmbiguityScoreHeuristic(state)` method that derives conservative clarity scores from the number of interview rounds and the user-origin ratio.
- Modified `calculateAmbiguityScore` to:
  1. Try `_calculateAmbiguityWithLLM` once.
  2. Retry automatically one time if the first call returns `null`.
  3. Fall back to the heuristic scorer if the retry also fails, without throwing.
  4. Skip caching the heuristic result as a cached LLM result so the LLM is retried on the next scoring attempt.
- Updated `buildScoreResult` to propagate `usedHeuristicFallback` into the result.
- Updated `formatInterviewReadinessGuide` to print an AskUserQuestion prompt when the score came from the heuristic fallback.

### AC-3 — Seed 5-section coverage guard

- Added `enforceSeedCoverage(plan)` in `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts`.
- The function checks the approved plan for Goal, Constraints, Acceptance, Ontology, and Evaluation sections.
- Called after `validateUltraPlanDrift` succeeds; returns an error result listing `Missing section: {name}` for any uncovered section.
- Ontology may be expressed through an explicit `Ontology` heading or through the existing `WorkGraph` / `AC Tree` sections, so the guard does not break plans that encode the task ontology structurally.
- Exported the function so it can be covered by a unit test.

### AC-4 — Bidirectional knowledge provenance

- Updated `createUltraworkEvidenceSeed` in `apps/liora/src/tui/commands/ultrawork.ts` to write `linked_from` and `linked_to` fields into the generated `liora-knowledge-map.json`, pointing to the project-local LLM Wiki index path.
- Updated `renderIndexPage` in `apps/liora/src/tui/commands/llm-wiki.ts` to add a `## Knowledge Provenance` section to `.superliora/wiki/index.md` with `linked_from` / `linked_to` references to the latest run's knowledge map.

### AC-7 — Regression tests

Added three regression tests in `packages/agent-core/test/agent/ultra-plan-mode.test.ts`:

1. `AC-1: exposes the auto-answer origin counter in the readiness guide`
2. `AC-2: falls back to deterministic heuristic when LLM scoring returns null`
3. `AC-3: enforceSeedCoverage flags a plan missing a Seed section`

## Verification Results

| Check | Command | Result |
|---|---|---|
| SDK declaration emit | `corepack pnpm -C packages/node-sdk run build:dts` | Passed |
| Workspace imports | `corepack pnpm run check:imports` | Passed |
| Agent core build | `corepack pnpm -C packages/agent-core run build` | Passed |
| Liora CLI build | `corepack pnpm -C apps/liora run build` | Passed |
| Liora CLI smoke | `corepack pnpm -C apps/liora run smoke` | Passed |
| UltraPlan unit tests | `corepack pnpm --filter @superliora/agent-core exec vitest run test/agent/ultra-plan-mode.test.ts` | 44/44 passed |

## Additional Suggestions

1. Consider adding a small dedicated test for `_calculateAmbiguityWithLLM` retry counting to guard against future refactors that collapse the two LLM calls into one.
2. The heuristic fallback currently never produces a ready state by design; once operational data is available, calibrate the formula against historical LLM scores instead of conservative lower bounds.
3. Move knowledge-map provenance validation into a repo script if more runtime artifacts begin carrying `linked_to` / `linked_from` fields.
4. Review whether the Rhythm Guard threshold (3 consecutive non-user answers) should be configurable per workspace.

## Changed Files

- `packages/agent-core/src/agent/plan/ultra-plan-mode.ts`
- `packages/agent-core/src/agent/injection/plan-mode.ts`
- `packages/agent-core/src/tools/builtin/planning/exit-plan-mode.ts`
- `packages/agent-core/test/agent/ultra-plan-mode.test.ts`
- `apps/liora/src/tui/commands/ultrawork.ts`
- `apps/liora/src/tui/commands/llm-wiki.ts`
- `.superliora/wiki/index.md`
- `.superliora/evidence/ultrawork-runs/2026-07-12T004332812Z-llm-f71822c7/liora-knowledge-map.json`
- `.changeset/ultraplan-flow-improvements.md`
- `docs/specs/2026-07-12-ultraplan-flow-improvements-report.md`
