---
"@superliora/liora": patch
---

Fix xAI Grok OAuth login stalling when the browser cannot redirect back to the local callback server. After a short wait, SuperLiora now prompts for the callback URL or authorization code so remote and blocked-port sessions can finish login.
