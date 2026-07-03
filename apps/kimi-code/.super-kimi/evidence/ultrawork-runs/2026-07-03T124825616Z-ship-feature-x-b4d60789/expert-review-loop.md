# Expert Review Loop

Created: 2026-07-03T12:48:25.616Z

Objective: Ship feature X

Review required: conditional

Before reporting completion, compare the actual result against each lane below. If any reviewer returns non-PASS, fix the concrete issue and repeat review until PASS or an explicit blocker is recorded.

| lane | owner | evidence needed |
|---|---|---|
| product_requirements | main integration owner | UltraGoal seed, AC Tree, Acceptance Criteria, non-goals |
| architecture_implementation | implementation owner | affected files, implementation plan, focused tests or runnable checks |
| testing_evidence | verification owner | test output, typecheck/lint/build status, runtime observation path |
| integration_ownership | main integration owner | integration notes, conflict resolution, final PASS/BLOCKED rationale |

Reviewer verdicts:

- pending
