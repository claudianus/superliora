---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/ultra-plan-interview-guide regression cases

- `pickNextInterviewFocus` — pins the Completion-Criterion prompt when the UltraGoal is not verifiable (researcher default vs seed-closer phrasing), the first-open-gap path with the section-guidance `askHint` (simplifier perspective) and the per-perspective suffix, the default "Baseline + Upgrade" suffix for sections without a per-perspective entry, the first floor-failure fallback, and the generic "vague requirement" fallback when nothing is missing.
- `formatInterviewReadinessGuide` — pins the READY header line, the soft-seed `open_gaps` and `clarity floors` lines, the "soft seed completeness still improving" line, the compact NOT-READY line (with `+N more` and the `RHYTHM: AskUserQuestion next` marker), the full NOT-READY line (heuristic-fallback warning, `verifiable_goal=false` hard blocker, `+N more` open-gaps truncation, `clarity floors` line, `Round cap` note, the `AskUserQuestion through the <perspective> perspective` instruction, and the `Lateral (<perspective>): …` hint), the `RHYTHM GUARD` warning at three non-user answers, the `Auto-answers: N/3` counter, and the `perspective=<x>` status footer.
