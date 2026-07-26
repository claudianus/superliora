---
"@superliora/agent-core": patch
---

test(agent-core): pin `agent/compaction/backstop.ts` fallback and emergency summary

The classical fallback path runs when the LLM summarizer fails so a long
session can still resume. Pin every branch with 9 regression tests:

- `shouldUseClassicalCompactionFallback`:
  - `false` for `AbortError` and `AUTH_LOGIN_REQUIRED` (caller should
    prompt, not fall back)
  - `true` for `APIEmptyResponseError`, 4xx/5xx `APIStatusError`, and
    `ChatProviderError`
  - `true` for known provider messages (`does not support parameter`,
    `invalid_request: 400`, `context overflow`, `response truncated`)
  - `false` for unrelated `Error`, `undefined`, `null`
- `buildEmergencyBackstopSummary`:
  - includes the latest user prompt, the emergency backstop marker, and
    the compacted token count when user input is present
  - falls back to the canonical "Continue the active task" line when no
    user prompt is in the conversation

The classification table is small but safety-critical: a future rewrite
that drops a category would strand a long session with no resume path.
