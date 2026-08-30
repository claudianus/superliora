---
"@superliora/liora": minor
"@superliora/agent-core": minor
"@superliora/kosong": patch
"@superliora/sdk": patch
---

Unify opencode Go/Zen to a single provider with smart per-model wire and predictable routing.

- Unify `opencode-go/muse` hard split into one provider per Go/Zen with model-level `protocol` (openai/openai_responses/anthropic) resolved by live `/models` + pattern fallback, not per-id hardcode. Extend `ModelAlias.protocol` to 3-way enum and generalize `provider-manager` wire resolution. Migrate legacy `opencode-go-muse` aliases and expose Go in the local catalog.
- Add worker inherit-parent routing: per-role `loopControl.*Model="inherit"` and global `workerInheritParent`/`workerInheritParentRoles` so workers can mirror the parent model for cache/consistency. TUI shows an explicit inherit row and CLI `provider route worker-inherit`.
- Add conductor model pool (`loopControl.conductorModelPool`/`conductorPoolMode`) so the orchestrator ranks only user-selected aliases, fixing cross-provider drift. CLI `provider route conductor-pool` and TUI pool hint.
