---
"@superliora/agent-core": minor
---

Replace the lossy head+tail preview for oversized tool outputs with a structured receipt (sha256, bytes, lines, summary1, captured_at, output_path); the full output stays on disk and the model re-acquires exact ranges with Read instead of re-running the tool
