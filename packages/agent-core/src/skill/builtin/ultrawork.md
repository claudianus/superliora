---
name: ultrawork
description: Ultrawork workflow methodology — run a long, multi-domain objective through UltraResearch -> UltraPlan interview -> UltraGoal -> Swarm decision -> Integrate -> Verify -> Learn. Load on /ultrawork (울트라워크) activation, or when orchestrating UltraResearch, UltraPlan, UltraGoal, UltraSwarm, or an UltraworkGraph work ledger.
---

# Ultrawork workflow methodology

Ultrawork is the full harness workflow for a long objective: interview the ambiguity out of it, plan with verifiable acceptance criteria, fan out specialist work when it pays, integrate, verify on real surfaces, and persist what was learned. This skill is guidance the agent follows itself — phase checkpoints are advisory, not hard gates. The only enforced gates are safety policies (plan-mode read-only, destructive-action confirmation).

## One workflow, one run

Spine, in order:

```
UltraResearch prelude -> UltraPlan interview -> UltraGoal
  -> Swarm decision -> Integrate -> Verify -> Learn
```

Normalize synonyms — 울트라플랜 / 울트라리서치 / 울트라골 / 울트라스웜, `/ultraplan`, `/ultraresearch`, `/ultragoal`, `/ultraswarm` — into the same run. Do not ask the user to choose between those sub-commands; steer the one run yourself.

## Activation and mode

- Shift-Tab turns Ultrawork mode ON; mode cannot turn off while a run is active. `/ultrawork` overrides the run; `/plan` is separate steering.
- Start mode: the TUI shows the Auto/YOLO/Manual chooser on create (default Manual, no memory). Headless/auto without TUI defaults to Manual. Resume inherits the current permission mode and skips the chooser.
- Activation forces Ultra Plan Research first: gather source-backed evidence before `AskUserQuestion`, and interview until the UltraGoal is true/false-verifiable.

## Research stage (read-only)

Investigation only — the product tree stays read-only here.

- Allowed: Read/Grep/Glob, Web/Context7, Liora* tools, read-only Bash, TodoList, NextPhase.
- No product Write/Edit, and no `AskUserQuestion` until an evidence pack exists.
- Research tools: prefer Context7Resolve/Context7Docs for library docs; WebSearch + FetchURL for primary sources, papers, CVEs, releases; LocalResearchStack as a free fallback. Re-search when new uncertainty appears; label findings stale/offline if live search fails; never defeat CAPTCHA/paywall/login/rate-limits.
- Subagents may use Context7Resolve/Context7Docs and WebSearch/FetchURL unless internet is forbidden.
- After the research pack: `NextPhase({ phase: "interview" })`.

## Interview stage

Interview when the UltraGoal is not yet true/false-verifiable, a missing decision blocks correctness, or evidence-backed upgrades materially improve the plan; otherwise record the safe assumption and move on.

- Expert-leader framing: offer Baseline + Upgrade options so the user picks the payoff, not just the safe default.
- Do research before `AskUserQuestion` when the answer needs evidence.
- End interview turns with `AskUserQuestion` / `RecordInterviewFinding` / `NextPhase`.
- Product Write/Edit is allowed under planMode for investigation prototypes; the formal plan file is preferred but not forced before every edit.
- The hard interview→design checkpoint: the UltraGoal must be true/false-verifiable. After the final needed answers: `NextPhase({ phase: "design" })`.

## Design and plan artifacts

UltraPlan (ultra-plan) owns the durable plan. Produce:

- **Seed Spec** — the refined objective and its completion contract.
- **AC Tree** — acceptance criteria, each independently checkable.
- **WorkGraph** — node id, AC id, stage, owner/lane, deps, required evidence.
- **Evaluation Plan** — how each AC is verified on a real surface.
- **Execution Plan** — ordered implementation steps.

Advance Design -> Review -> Write -> Exit via `NextPhase` / `ExitPlanMode`. `ExitPlanMode` remains the approval point before post-plan implementation.

## UltraGoal

Create or replace the UltraGoal only after plan approval — unless `/goal` already created the active goal. In that case harden the existing seed and finish with `UpdateGoal complete/blocked`; never call `CreateGoal` again for the same work. If UltraPlan refines the objective, write the refined Seed, AC Tree, WorkGraph, Acceptance Criteria, Evaluation Plan, and Execution Plan into the plan file under the existing goal.

## Swarm decision

After ExitPlanMode + UltraGoal, UltraworkGraph seeds from WorkGraph. Then decide the swarm:

- Emit exactly: `Swarm decision: ENGAGE|DEFER - <reason>; value: <specialist value or none>; owner: <verification owner>`.
- ENGAGE when more than one material lane, subjective quality, high risk, hard-to-observe behavior, or independent review is involved; call `UltraSwarm` (with `work_node_ids`) before further product implementation edits.
- DEFER only if the main agent owns every lane; a DEFER needs a visible waiver.
- Prefer `UltraSwarm auto_select`. Swarm mode is the substrate — call UltraSwarm only when specialist parallel work materially improves quality or speed.
- Integrate before editing; verify real surfaces; Learn only verified durable findings.

## Ledger and kanban

- UltraworkGraph is the AC/work ledger; TodoList is the derived kanban (Doing/Next/Done).
- After approval, update UltraworkGraph before product edits; keep one derived todo `in_progress`; mark nodes done only with verification evidence.
- Capability Coverage Matrix: criterion/risk -> expertise -> evidence -> expert -> owner, derived from UltraGoal + AC Tree. Report the matrix, specialist usage, evidence paths, and risks.

## Evidence and workflow transparency

- Use the runtime evidence seed (when provided in the activation prompt) as the LLM Wiki / knowledge-map / coverage / review ledger root; do not leave proof only in chat.
- Maintain `workflow-report.md` + `workflow-stages.json`; fill each stage narrative before leaving the stage.
- Knowledge persistence ledger: final reports need `liora_recall` / `llm_wiki` rows with `wrote|skipped|blocked` + reason/path/id/evidence (`.superliora/wiki`). Promote seed wiki/knowledge-map only in Learn with evidenceState verified.
- Memory is for durable context/preferences only.

## Core operating rules

- **Liora Lean Context:** prefer LioraRead (signatures/map/lines), LioraSymbol, LioraTree, LioraCallgraph, and Grep before broad Read dumps; cite paths; keep context small.
- **Liora Knowledge Map:** map from LioraRead/LioraSymbol/LioraTree, Grep, memory, and artifact summaries before broad exploration. Prefer EXTRACTED edges over INFERRED; mark AMBIGUOUS and resolve with targeted reads/tests.
- **Definition of Done:** inspect files/tests/rules first; small changes; focused tests when practical; relevant checks; finish only with evidence and remaining risks. Prefer deterministic verification over model claims.
- **Premium Quality (default ON in Ultrawork):** the Premium injector owns the full bar. For web/app/dashboard/game surfaces, write an Art Direction Brief before visual work; SearchSkill for design skills; screenshot-proof before done.
- **Human Writing / Anti-Slop:** light pass by default; SearchSkill -> Skill only for docs/PR/changelog/TUI/plan prose; plain specific claims over hype.

## Surface capabilities (conditional)

### Browser / computer-use verification (visual surfaces)

- Use BrowserUse/ComputerUse for rendered pages, visual QA, downloads, and desktop evidence when useful; prefer headless/background capture.
- Prefer BrowserObserve refs and ComputerCapture SOM indexes over raw coordinates; screenshot before claiming visual/interactive done.
- Safe GUI may auto-run in auto/yolo; high-risk GUI still needs approval. If blocked, record the blocker and use next-best evidence.

### LioraBench (harness/TUI benchmark surfaces)

- For harness/TUI benchmark or SOTA claims, use `node scripts/liora-agent-sota-gate.mjs` or `node scripts/qa-superliora-autonomous.mjs --phase sota-gate` (C001 system, C002 live TUI, C003 budget/cleanup/secret scan). Do not treat browser-only UI as TUI success.

## Finish

End with real-surface verification, the knowledge persistence ledger, and `UpdateGoal complete/blocked`.
