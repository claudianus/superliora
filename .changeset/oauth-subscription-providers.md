---
"@superliora/liora": minor
"@superliora/oauth": minor
"@superliora/agent-core": patch
---

Add account-login providers in /login: Qwen (device code), MiniMax Coding Plan global and China (user code), Nous Portal (device code with live model discovery), OpenRouter (browser consent that mints an API key), Devin (browser sign-in with the Cascade model roster), Factory Droid (WorkOS device code with org and region scoping), Muse Code (Meta device code), and Kilo Gateway (device code). Google Antigravity login is also available behind an opt-in flag; set SUPERLIORA_EXPERIMENTAL_GOOGLE_ANTIGRAVITY_OAUTH=1 to surface it.
