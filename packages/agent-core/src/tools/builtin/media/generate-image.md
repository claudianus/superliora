Generate an image from a text prompt into the workspace.

Icons, mockups, hero/product shots. Prefer over ad-hoc scripts when a provider key is present.

Provider (first match): `QWEN_TOKEN_PLAN_API_KEY` → Qwen Cloud (default `wan2.7-image`; `wan2.7-image-pro`, `qwen-image-2.0` via `model`); else `OPENAI_API_KEY` → OpenAI Images; else `GOOGLE_API_KEY`/`GEMINI_API_KEY` → Gemini. `/status` readiness (no MCP). Default `.superliora/generated/images/<timestamp>.png`. Report path; use ReadMediaFile when image input is available.
