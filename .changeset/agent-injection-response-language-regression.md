---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/response-language regression cases

- `buildResponseLanguageDirective()` wrapping + body branches (default wrap,
  `wrapped: false` unwrapped, locked phrases present).
- `ResponseLanguageInjector.getInjection()`: undefined preference, first emit,
  preference-key change re-emit, `onContextClear` cache reset.
