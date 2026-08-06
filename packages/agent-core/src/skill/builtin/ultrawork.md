---
name: mission
aliases:
  - ultrawork
description: Mission workflow methodology (ultrawork compat) — run a long multi-domain objective through Research → Plan interview → Goal → Fleet decision → Integrate → Verify → Learn. Load via Skill as `mission` (preferred) or `ultrawork` on /mission activation.
---

# Mission workflow methodology

Mission is the full harness workflow for a long objective: interview the ambiguity out of it, plan with verifiable acceptance criteria, fan out Job workers when it pays, integrate, verify on real surfaces, and persist what was learned.

Load via Skill as **`mission`** (preferred). The `ultrawork` alias is compatibility only and runs the **same** run — do not start a second spine.

## Hard vs soft (do not confuse)

| Rule | Enforcement |
|------|-------------|
| Plan-phase product Write/Edit | **HARD deny** — only plan file + Mission evidence root until ExitPlanMode |
| NextPhase order | **HARD** — forward one step only; no skip/reverse |
| interview→design verifiable Goal | **HARD** — unless `force_unverified=true` + `override_reason` recorded |
| ExitPlanMode minimum plan artifacts | **HARD** — Seed completion criterion, AC Tree, WorkGraph, Fleet/Swarm decision, Evaluation + Execution plans |
| Live Mission goal complete | **HARD** — seeded WorkGraph + completion audit + real verification action |
| Interview style, Baseline/Upgrade framing | Soft guidance (Auto records structured decisions) |
| Premium polish / anti-slop | Soft guidance |

## One workflow, one run

```
Research prelude -> Plan interview -> Goal
  -> Fleet decision (ENGAGE|ADAPTIVE|DEFER) -> Integrate -> Verify -> Learn
```

Normalize synonyms — Ultrawork, UltraPlan, UltraGoal, `/ultrawork`, `/ultraplan` — into this **Mission** run. Do not ask the user to choose between branded sub-commands.

## Activation and mode

- Shift-Tab / `/mission` turns Mission on. `/ultrawork` is a compat alias.
- Auto mode: AskUserQuestion is auto-answered with structured Baseline/Recommended decisions (reason + confidence recorded into interview findings). Keep writing high-quality options so auto can form a true/false-verifiable goal.
- Manual mode: read-only tools, plan-file writes, and evidence-root writes are auto-approved during plan phases — product mutation still denied until ExitPlanMode.
- Activation forces Research first: gather source-backed evidence before questions when the answer needs facts.

## Research stage (plan mode)

- Allowed writes: **Mission plan file + evidence root only**.
- Allowed reads: Read/Grep/Glob, Web/Context7, Liora*, read-only Bash, TodoList, NextPhase.
- No product Write/Edit. Prefer evidence pack before open-ended AskUserQuestion.
- After the research pack: `NextPhase({ phase: "interview" })`.

## Interview stage

Interview when the Goal is not yet true/false-verifiable, a missing decision blocks correctness, or evidence-backed upgrades improve the plan.

- Expert-leader framing: **Baseline + Upgrade** options (mark Recommended when appropriate).
- End turns with `AskUserQuestion` / `RecordInterviewFinding` / `NextPhase`.
- Hard gate to design: `NextPhase({ phase: "design" })` only when verifiable, or with explicit `force_unverified` + `override_reason`.

## Design and plan artifacts

Produce in the plan file:

- **Seed Spec** — refined objective + completion contract (true/false criterion)
- **AC Tree** — independently checkable acceptance criteria
- **WorkGraph** — node id, AC id, stage, owner/lane, deps, required evidence
- **Fleet / Swarm Decision** — `Swarm decision: ENGAGE|ADAPTIVE|DEFER - …`
- **Evaluation Plan** + **Execution Plan**

Advance Design → Review → Write → Exit via `NextPhase` / `ExitPlanMode`. ExitPlanMode is the **approval point** before post-plan implementation; missing minimum sections **hard-fail**.

## Goal

Create or replace Goal only after plan approval — unless `/goal` already created the active goal. Finish with `UpdateGoal complete/blocked` only after WorkGraph + verification pass.

## Fleet decision

After ExitPlanMode + Goal, seed WorkGraph. Then decide:

- Emit: `Swarm decision: ENGAGE|ADAPTIVE|DEFER - <reason>; value: …; owner: …`
- ENGAGE/ADAPTIVE → fan the work out to Job workers (`JobCreate`) before more product implementation; carry the `work_node_ids`, coverage matrix, acceptance criteria, and verification owner in the job descriptions.
- DEFER only if main owns every lane (visible waiver).

## Coding quality (Mission implementation)

While implementing (after ExitPlanMode):

- Prefer small, reviewable diffs; match package AGENTS.md and existing patterns.
- Lean Context: RepoQuery/Grep before broad Read dumps.
- Definition of Done: inspect tests/rules; run scoped checks (`RunProjectChecks`, package tests); attach evidenceIds; set `verificationStatus=passed` only after real checks.
- No false complete: empty/incomplete WorkGraph or missing verification **blocks** UpdateGoal(complete).

## Evidence

Use the runtime evidence seed as LLM Wiki / knowledge-map / coverage / review ledger root. Maintain workflow-report + stage narratives. Learn only verified durable findings.

## Finish

End with real-surface verification, knowledge persistence ledger, and `UpdateGoal complete/blocked`.
