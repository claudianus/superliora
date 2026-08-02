---
'@superliora/agent-core': patch
---

Green check-like Bash (typecheck/lint/tsc/vitest/turbo/bun, including `pnpm -C … run|exec`) now clears verification failure evidence and sticky mutation soft-state the same way RunProjectChecks does — fixing a residual gap where only dedicated check tools unstuck post-edit sensors.
