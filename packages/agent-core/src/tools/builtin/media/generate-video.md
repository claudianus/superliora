Generate a short video from a text prompt (optional first-frame image).

Use for product demos, motion mockups, and short UI/animation previews when `GOOGLE_API_KEY`/`GEMINI_API_KEY` is set.

Provider: Google Gemini video path when available. Check readiness with `/status` (no MCP setup).

Default path: `.superliora/generated/videos/<timestamp>.mp4`. Report the path; use ReadMediaFile when the model supports video input.