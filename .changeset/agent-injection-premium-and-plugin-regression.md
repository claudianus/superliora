---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/{premium-quality, plugin-session-start} regression cases

- `resolveActivePremiumDensity(agent)` goal-vs-ultrawork objective priority
  plus `ultraworkObjectiveProfile` lookups keyed by `premiumDensity`.
- `renderPluginSessionStartReminder` empty / missing-registry / missing-skill
  (with warn log) / happy-path branches.
- `PluginSessionStartInjector` already-injected short-circuit and history
  replay dedup.

fix(agent-core): add missing `?.` to `agent.goal?.getGoal?.()?.goal?.objective`
in `resolveActivePremiumDensity` so the chain short-circuits when the
`getGoal()` result is `null` instead of throwing.
