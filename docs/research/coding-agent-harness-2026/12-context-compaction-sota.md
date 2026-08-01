# 12 — Context Compaction SOTA (Claude Code / Codex / OpenCode / Hermes)

> SuperLiora implementation target after the 2026-08-01 multi-million-token regression.
> Industry sources: Codex `compact.rs`, OpenCode `session/compaction.ts`, Anthropic context editing + Claude Code reverse-engineering, Hermes cache-sacred principle.

## Industry stack (steal, do not invent)

| Layer | Who | Cost | When |
|---|---|---|---|
| **L0 Write-time budget** | Claude Code tool budget, SuperLiora `budgetToolResultForModel` | 0 LLM | Every tool result |
| **L1 Micro / prune** | Claude Code tool-result clearing; OpenCode prune (hide old tools) | 0 LLM | ~40% usage / ~140k working set |
| **L2 Full structured summarize** | Codex handoff memo; Claude 9-section; OpenCode 5-heading | 1 LLM | Soft trigger / working-set cap |
| **L3 Overflow recovery** | Claude reactive compact; stated prompt-limit parsing | multi-round | Provider 400/413 |

## Design principles

1. **Cheap first.** Never call an LLM to free tokens if L0/L1 can reclaim them.
2. **Working set ≠ advertised window.** Cap soft compact ~256k even on 1M models (lost-in-the-middle + cost).
3. **History can stay append-only on wire** while **projection** masks old tool dumps (cache-friendly prefix).
4. **Stated API limit wins** over catalog `max_context_tokens` after overflow (`maximum prompt length is N`).
5. **Hard residual re-arms** — a “complete” that leaves context over block must not set hysteresis that skips recompact.
6. **Hermes: prompt-cache is sacred** — micro clears near the *end* of the clearable window (family overflow), not the frozen prefix.

## SuperLiora mapping

| Layer | Module |
|---|---|
| L0 | `agent/turn/tool-result-budget.ts` + `tools/support/result-builder.ts` |
| L1 | `agent/compaction/micro/*` via `context.project` + `step-loop` `detect()` |
| L2 | `agent/compaction/full/*` + pipeline multi-round until soft threshold |
| L3 | `kosong` overflow patterns + `observeContextOverflow(statedLimit)` |

## Success metrics

- Single Bash/log dump cannot push session past ~24k chars model-visible without spill.
- Soft compact fires near min(ratio×window, 256k), not at 90% of a 2M catalog lie.
- After compact, residual over block re-triggers (no growth hysteresis).
- `maximum prompt length is 500000` → observed ceiling ~425k → subsequent full compact targets real API limit.
