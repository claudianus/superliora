---
"@superliora/agent-core": patch
---

Stop paying a language-detection LLM call on every user message. Once a session's response language is locked, a locked preference can only move on an explicit demand, so the per-message detection now only runs when the message plausibly asks for a language switch (`/lang`, "answer in French", `한국어로 답변해줘`, `日本語で`, …); otherwise the locked preference is reused deterministically. Long interactive sessions drop from one detection call per prompt to one per session plus explicit switch requests.
