---
'@superliora/agent-core': patch
---

fix(agent-core): expose a typed `SubagentMaxTokensError` from the subagent
host so callers can identify max-tokens failures without substring-matching
the human error message. The subagent batch now tags failed outcomes with a
`failureReason` of `'max_tokens' | 'transient' | 'aborted' | 'other'` so
recovery prompts can steer the user toward a larger context budget instead
of a transient retry for terminal max-tokens failures.
