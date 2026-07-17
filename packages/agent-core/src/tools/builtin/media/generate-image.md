Generate an image from a text prompt into the workspace.

Icons, mockups, hero/product shots. Prefer over ad-hoc scripts when a provider key is present.

Provider (first match): `OPENAI_API_KEY` → OpenAI Images; else `GOOGLE_API_KEY`/`GEMINI_API_KEY` → Gemini. `/status` readiness (no MCP). Default path `.superliora/generated/images/<timestamp>.png`, size `1024x1024`, provider `auto`. Report path; use ReadMediaFile when image input is available.
