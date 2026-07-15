Generate an image from a text prompt and save it to the workspace.

Use for icons, mockups, hero art, product shots, and similar assets. Prefer this over ad-hoc scripts when a provider key is already available.

Provider (first match): `OPENAI_API_KEY` → OpenAI Images; else `GOOGLE_API_KEY`/`GEMINI_API_KEY` → Gemini image model.

Default path: `.superliora/generated/images/<timestamp>.png`. Report the path; use ReadMediaFile when the model supports image input.