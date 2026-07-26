---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/intelligence/prompt-intelligence.ts regression cases

- `looksLikeCheapCompletionModel` — pins the cheap-model marker detection (gpt-4o-mini, haiku, minimax:mini, case-insensitive) and the rejection of expensive flagship models (gpt-4o, claude-opus-4).
- `pinCompletionThinking` — pins the optional-return shape (returns the provider with thinking effort overridden, or `undefined` when no override applies).
- `extractDraft` — pins the trim of the `text` field at the `cursorLine`.
- `summarizeHistory` — pins the empty-history empty string, the `role: text` join with empty-part drop, and the small-cap clamp that yields a clipped line.
- `cleanInlineCompletion` — pins the raw-completion passthrough, the `trimEnd`-only overlap-strip (preserves a leading space), and the empty/identical-draft empty-string return.
- `parseSuggestionLines` — pins the trim / non-empty / dedup-while-preserving-order rule and the empty-input empty-list return.
