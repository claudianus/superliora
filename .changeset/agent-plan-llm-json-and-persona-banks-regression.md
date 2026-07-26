---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/ultra-plan-llm-json + persona-banks regression cases

- `extractTextFromLLMResponse`, `extractJsonFromText`, `parseJsonFromLLMResponse`
  cover fenced code blocks, embedded JSON, malformed JSON, and missing content.
- `THINKING_PERSONA_SUMMARIES`, `THINKING_PERSONA_QUESTION_BANKS`,
  `questionsForThinkingPersona` cover persona completeness, mutation safety,
  and stable shape.
