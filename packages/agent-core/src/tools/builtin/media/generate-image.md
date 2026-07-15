Generate an image from a text prompt and save it to the workspace.

Use when the user asks for icons, mockups, hero art, product shots, or other visual assets. Prefer this over shelling out to ad-hoc scripts when a provider key is already available.

Provider selection (first match wins):
1. `OPENAI_API_KEY` → OpenAI Images API (`gpt-image-1`, falls back to `dall-e-3`)
2. `GOOGLE_API_KEY` or `GEMINI_API_KEY` → Gemini image model (`gemini-2.0-flash-preview-image-generation`)

Writes PNG/JPEG bytes under the given path (default `.superliora/generated/images/<timestamp>.png`). After generating, use ReadMediaFile (when the model supports image_in) or report the path to the user.
