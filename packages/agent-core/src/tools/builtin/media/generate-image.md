Generate an image from a text prompt into the workspace.

Icons, mockups, hero/product shots. Prefer over ad-hoc scripts when a provider key is present.

Provider (first match): `OPENAI_API_KEY` → OpenAI Images; else `GOOGLE_API_KEY`/`GEMINI_API_KEY` → Gemini. `/status` shows readiness (no MCP). Default: `.superliora/generated/images/<timestamp>.png`. Report path; use ReadMediaFile when image input is available.
