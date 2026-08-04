Generate an image from a text prompt into the workspace.

Icons, mockups, hero/product shots. Prefer over ad-hoc scripts when a provider key is present.

Provider (first match): `QWEN_TOKEN_PLAN_API_KEY`/`ALIBABA_TOKEN_PLAN_API_KEY` → Qwen Cloud Token Plan (default `wan2.7-image`); else `OPENAI_API_KEY` → OpenAI Images; else `GOOGLE_API_KEY`/`GEMINI_API_KEY` → Gemini. Default `.superliora/generated/images/<timestamp>.png`. Report path; use ReadMediaFile when image input is available.
