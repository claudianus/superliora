---
name: recursive-improve
description: Meta self-improvement loop — analyze execution traces, identify failure patterns and inefficiencies, propose and apply improvements to harness code/prompts/config, then verify with tests. Invoke via /improve or when the agent should improve itself.
---

# Recursive Self-Improvement Loop

You are entering a meta-improvement cycle. The target is your own harness: agent-core code, system prompts, tool definitions, skills, injection logic, and configuration. You are both the engineer and the system being improved.

## Loop structure

Each improvement cycle follows this spine:

```
Observe → Diagnose → Propose → Apply → Verify → Record
```

### 1. Observe (collect evidence)

Gather execution evidence from available sources:
- **Session history**: review recent turns for repeated failures, retries, dead ends, or user corrections.
- **Tool results**: look for error patterns, timeouts, truncated outputs that forced workarounds.
- **User feedback**: explicit complaints, rejections, "that's not what I meant", re-asks.
- **Test results**: failing tests, flaky tests, coverage gaps in changed areas.
- **Memory**: search Liora Recall for past failure patterns and unresolved issues.

Quantify: count occurrences, identify the top 3 most impactful problems by frequency × severity.

### 2. Diagnose (root cause)

For each top problem:
- Trace the failure to its root cause in code or prompt text.
- Classify: (a) prompt/guidance gap, (b) tool behavior bug, (c) missing capability, (d) unnecessary friction/gate, (e) performance waste.
- Determine blast radius: what else touches this code path?

### 3. Propose (minimal fix)

For each root cause, design the smallest change that eliminates the problem:
- Prefer deleting unnecessary code over adding new code.
- Prefer softening a hard gate to advisory over removing it entirely.
- Prefer prompt guidance over mechanical enforcement.
- Never weaken safety gates (sensitive-file-access, destructive-action confirmation, permission policies).
- Estimate impact: which future sessions benefit, and how much?

### 4. Apply (implement)

- Make focused, atomic changes. One concern per edit.
- Follow existing code style and architecture patterns.
- Update tests if behavior changed.
- If the change touches `packages/agent-core` or `packages/node-sdk`, ensure commit atomicity (AGENTS.md rule).

### 5. Verify (prove it works)

- Run typecheck: `npx tsc --noEmit -p packages/agent-core/tsconfig.json`
- Run affected tests: `npx vitest run <test-file>`
- For structural changes (barrel, exports, new modules), run the full source-install gate:
  1. `pnpm -C packages/node-sdk run build:dts` — catches multi-line imports grep misses
  2. `pnpm run build`
  3. `pnpm run check:imports`
  4. `pnpm -C apps/liora run build`
  5. `pnpm -C apps/liora run smoke`
- Also check server: `npx tsc --noEmit -p packages/server/tsconfig.json` (server uses tsdown, no typecheck in build)
- If possible, construct a scenario that would have triggered the old failure and confirm it now succeeds.

### 6. Record (persist learning)

- Write a Liora Recall memory with: what was wrong, what was changed, why, and the verification result.
- If the improvement reveals a pattern, note it for future cycles.

## Constraints

- **Safety is non-negotiable.** Never remove or weaken: sensitive-file-access-deny, yolo-high-risk-ask, gui-use-safety, plan-mode-guard-deny, permission policy chain.
- **One cycle = one focused improvement.** Do not attempt to fix everything at once. Pick the highest-impact issue, fix it well, verify, record. Then optionally start another cycle.
- **Respect architecture.** Agent standalone constraint, workspace membership rules, experimental flag gating — all still apply.
- **User awareness.** In goal mode, record what you changed. In interactive mode, briefly tell the user what you improved and why.
- **No speculative generality.** Fix real observed problems, not hypothetical ones.

## When to invoke

- `/improve` slash command
- Goal mode with objective containing "improve", "개선", "self-improve", "자기개선"
- After a session with multiple failures or user corrections
- When explicitly asked to improve the harness

## Anti-patterns (do not)

- Do not refactor working code just because it looks different from your preference.
- Do not add configuration knobs for problems that have one correct answer.
- Do not create new abstractions to solve a problem that a 3-line fix addresses.
- Do not improve prompts by making them longer — prefer precise over verbose.

## Diminishing returns (when to pause)

After several cycles, easy targets (dead exports, deprecated aliases, unused modules) get exhausted. Before starting another cycle, check:

- **Scan breadth**: have you scanned all major packages and modules for dead code? If yes, the remaining targets are structural (circular deps, architecture) or subjective (prompt wording).
- **Risk vs reward**: structural refactors (circular deps, barrel wildcard removal with many consumers) carry high breakage risk for marginal gain. Prefer stopping over forcing low-value changes.
- **Shift domains**: if code cleanup is exhausted, shift to prompt/skill/tool-description improvements — but these are harder to verify objectively.
- **Report and pause**: when no verifiable improvement remains, report cumulative results and pause the loop rather than inventing work.

## Barrel pruning methodology

When converting `export * from './module'` to explicit exports:

1. **Temp-remove** the wildcard (comment it out).
2. **Run `build:dts`** — this is the definitive check. Grep-based cross-referencing misses multi-line imports and will give false "zero consumers" results.
3. **Extract missing symbols** from the error output: `grep "error TS" | grep -o "'[A-Za-z]*'" | sort -u`.
4. **Add explicit exports** for only the consumed symbols. Classify as `type` vs value exports.
5. **Also check server**: `npx tsc --noEmit -p packages/server/tsconfig.json` — server uses tsdown (no typecheck in build), so errors only surface via tsc.
6. **Run the full gate** before recording success.

Key lesson: `build:dts` catches what grep cannot. Always trust the compiler over manual cross-referencing.
