Generate a short video from a text prompt (optional first-frame image).

Product demos, motion mockups, UI/animation previews when a provider key is set.

Provider (first match): `QWEN_TOKEN_PLAN_API_KEY` → Qwen Cloud (happyhorse-1.1-t2v/i2v, async task); else `GOOGLE_API_KEY`/`GEMINI_API_KEY` → Gemini. `/status` readiness (no MCP). Default `.superliora/generated/videos/<timestamp>.mp4`. Report path; use ReadMediaFile when video input is available.
