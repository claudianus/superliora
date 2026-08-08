---
"@superliora/liora": patch
---

Stop visual verification from burning the full agent time budget: skip unused browser fallback installs when the primary runtime is ready, and fail VerifySurface within two minutes instead of hanging until the thirty-minute deadline.
