---
'@superliora/agent-core': patch
---

test(agent-core): pin tools/policies/shell-dedicated-bypass regression cases

- `SHELL_DEDICATED_BYPASS_FORCE_PREFIX` constant pin (`LIORA_FORCE_BASH=1`).
- `detectShellDedicatedBypass()` safe / empty / escape-hatch-allowed branches.
- `formatShellDedicatedBypassError()` mentions the `LIORA_FORCE_BASH` escape
  hatch and the blocked-by-dedicated-tool language.
