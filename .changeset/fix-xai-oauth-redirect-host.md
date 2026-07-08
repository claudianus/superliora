---
"@superliora/liora": patch
---

Fix xAI (Grok) OAuth login failing with "redirect_uri does not match any registered URI". The callback server sent `http://localhost:56121/callback`, but the official Grok CLI OAuth app registers `127.0.0.1` as the redirect host; xAI matches redirect URIs by exact string, so the two did not agree. The redirect host is now configurable per provider and xAI uses `127.0.0.1`.
