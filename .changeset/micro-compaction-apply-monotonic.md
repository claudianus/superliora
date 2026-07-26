---
"@superliora/agent-core": patch
---

fix(agent-core): clamp and guard `MicroCompaction.apply` cutoff monotonicity

`cutoff` is the absolute index up to which the clearable window has been
removed. It is monotonically increasing within a session: a smaller value
would un-mask history items that were already micro-cleared (and therefore
no longer recoverable from the model's perspective), letting the LLM re-read
the same content twice. `apply` now:

- clamps a negative `cutoff` to `0` (defensive — detection logic should not
  pass a negative value),
- never lets the new `cutoff` regress behind the previous one.

Four regression tests in `test/agent/compaction/micro.test.ts` pin the
behaviour: smaller value rejected, negative clamped when starting at zero,
negative clamped when starting at a positive cutoff, and `reset(0)` returns
to baseline.
