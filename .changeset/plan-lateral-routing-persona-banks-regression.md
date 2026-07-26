---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/ultra-plan-persona-banks.ts and ultra-swarm-routing.ts regression cases

- `ultra-plan-persona-banks.ts` — pins the 5 documented personas (architect / contrarian / hacker / researcher / simplifier) with non-empty summaries, the 3-questions-per-persona bank size, and the mutation-safe `questionsForThinkingPersona` (returns a fresh copy on every call).
- `ultra-swarm-routing.ts` — pins `intensityToDefaultExpertCount` (light=4 / standard=12 / heavy=24), `routeFromPlanSignals` (no-decision undefined, ENGAGE → heavy/24, DEFER → light/0 with default single-owner rationale, `--swarm` and `Force Swarm: yes` upgrades DEFER→ADAPTIVE standard/12, `swarm intensity: light` override respected, and the per-decision rationale strings).
