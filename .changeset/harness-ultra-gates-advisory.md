---
'@superliora/agent-core': minor
---

Convert Ultra Plan ritual gates from hard blocks to non-blocking guidance

- Remove the `ultra-swarm-engage-gate-deny` permission policy: an approved ENGAGE decision no longer denies product tools until UltraSwarm runs. The ExitPlanMode output still recommends the next step.
- Plan mode guard now only protects the plan-file boundary (Write/Edit outside the active plan file). Ultra phase denies are gone: RecordInterviewFinding phase/rhythm guards, AskUserQuestion research block, EnterPlanMode re-entry block, ExitPlanMode phase block, and TaskStop block all defer to the user's permission mode. CronCreate/CronDelete stay denied in plan mode because scheduled jobs outlive the plan.
- ExitPlanMode no longer blocks on early phases, missing seed sections, uncovered Seed Spec sections, or plan drift. It approves the plan and appends advisory notes; drift no longer reopens the interview.
- NextPhase interview→design no longer requires a verifiable UltraGoal. It advances, soft-fills the Seed Spec, and appends the readiness guide as a non-blocking warning.
- ENGAGE plan approval now prints a "Recommended Next Action" (was "Required", "binding") so the prompt matches the non-enforced behavior.
