---
'@superliora/agent-core': patch
---

test(agent-core): pin session/prompt-metadata.ts and hooks/user-prompt.ts regression cases

- `prompt-metadata.ts` — pins `titleFromPromptMetadataText` 200-char cap; `promptMetadataTextFromPayload` text-part join with `[image]` placeholder, empty-part + think drop, secret redaction (Authorization Bearer, `api_key=`, `password=`, RSA `-----BEGIN…-----` block, `sk-…` prefix, 80+ alphanumeric run, control chars), 4000-char cap, and `undefined` for all-empty input; `promptMetadataTextFromSkill` and `promptMetadataTextFromPluginCommand` (`/name args` formatting with trimmed args, omitted trailing space when args are empty/undefined).
- `hooks/user-prompt.ts` — pins `renderHookResult` `<hook_result hook_event="…">` wrap, `renderUserPromptHookResult` (undefined for missing, filter of `block`/timeout/non-zero-exit, blank-line joined `<hook_result>` blocks, empty-message drop, single `event: 'UserPromptSubmit'` envelope), and `renderUserPromptHookBlockResult` (undefined for no-block, first block wins, message → reason → documented default fallback chain).
