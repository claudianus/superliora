---
"@superliora/agent-core": patch
---

test(agent-core): pin `classifySubagentFailureReason` branch order

Recovery prompts steer the user toward a larger context budget on
`max_tokens`, a transient retry on 5xx / connection failures, and a
generic "other" path otherwise (rate-limit errors are deliberately
*not* transient — they go through the capacity-aware path). `classifySubagentFailureReason`
is now exported and four branch-order tests pin the classification so a
future reorder cannot silently route a terminal `max_tokens` failure
into a transient retry or vice versa. The test also confirms that
`status='aborted'` wins over the underlying error type so a user-cancelled
max_tokens run still reports as `aborted`.
