---
"@superliora/agent-core": minor
"@superliora/liora": minor
---

**Research-aligned compaction ladder + premium TUI cadence**

- Align default soft/hard with public docs + `LoopControlSchema`: soft **0.80**, hard **0.92**, reserved **50k**, absolute **200k**, maxRecent **4**.
- Async full compact starts at **0.70** (real band before soft); swarm handoff matches soft **0.80**; swarm micro pressure **0.40**.
- Add `assertCompactionLadderSafety` floors so densify cannot reintroduce soft≈async thrash or multi-char-style absolute/reserved collapse.
- Footer/status/usage severity and `/compact` hints follow async70 / soft80 / hard92 (not 1% usage).
- Premium ambient floor returns to **~30fps (33ms)** with short comet trails; animation scheduler hard-caps **min 16ms** so 1ms densify cannot thrash terminals.
- Export ladder constants via `@superliora/sdk` and wire TUI footer/status/usage through one `context-ladder` helper so UI thresholds cannot drift from the engine.
- Align Grep schema text with `DEFAULT_HEAD_LIMIT = 20`; refresh seed token/web contracts to research ladder (async70/soft80/hard92/web3).
- Archive 200+ densify-numerology holdouts under `.superliora/bench/archive/densify-holdouts/` so LioraBench stays a small quality gate, not a densify ledger.
- Promote research/media/ZDR/token seed+holdout contracts to `source_command` checks against real engine/TUI sources (not fixture prose only).

Evidence: Lost in the Middle (arXiv:2307.03172), MemGPT (2310.08560), LongLLMLingua (2310.06839), OpenCode overflow/prune, Anthropic server-side compaction docs, SuperLiora config contract, terminal UI frame-budget practice.
