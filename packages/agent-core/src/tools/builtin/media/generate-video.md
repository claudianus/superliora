Generate a short video from a text prompt (optional first-frame image).

Product demos, motion mockups, UI/animation previews when `GOOGLE_API_KEY`/`GEMINI_API_KEY` is set.

Provider: Google Gemini video when available. `/status` readiness (no MCP). Default path `.superliora/generated/videos/<timestamp>.mp4`, aspect `16:9`, duration `5s`. Report path; use ReadMediaFile when video input is available.
