---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/config/thinking pure resolver regression cases

- `resolveThinkingLevel` covers `defaultThinking: false`, empty request
  with config fallback, non-empty request override, and model-supported
  clamping.
- `resolveThinkingEffort` covers explicit `mode: 'off'`, model default
  fallback, `on` alias semantics, literal `off` precedence, and
  unrecognised request fallback.
- `defaultThinkingEffortFor` covers model default, support-list midpoint,
  undefined model, and unrecognised default effort.
- `clampEffortToModelSupport` covers `off` passthrough, missing
  `supportEfforts`, supported effort passthrough, and downward /
  upward snapping for unsupported rungs.
