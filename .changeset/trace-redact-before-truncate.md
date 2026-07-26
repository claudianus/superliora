---
'@superliora/agent-core': patch
---

fix(agent-core): redact session-trace secrets before string truncation

`sanitizeString` in the session-trace builder previously truncated long
strings first and then ran the secret value patterns, which silently
leaked any `sk-…` or `Bearer …` token that lived past the 4000-character
truncation boundary. The new order redacts first, then truncates, and
the truncation marker now reports the dropped character count for
debugging. The secret regex was also loosened — the previous `\b…\b`
form under-matched tokens that were embedded inside long word-char runs
(e.g. `'x'.repeat(5000) + 'sk-…'`); a non-anchored match with a trailing
lookahead is used instead, on the principle that over-matching is safer
than under-matching for secret detection.
