Generate a short video clip from a text prompt (and optional first-frame image) when a video-capable provider key is available.

Use for product demos, motion mockups, and short UI/animation previews. Prefer this over ad-hoc scripts when `GOOGLE_API_KEY` / `GEMINI_API_KEY` is already set.

Provider:
- Google Gemini Omni Flash preview (`gemini-omni-flash-preview`) via the Interactions-style generateContent path when available.

Writes under `.superliora/generated/videos/<timestamp>.mp4` by default. Report the path; use ReadMediaFile when the model supports video_in.
