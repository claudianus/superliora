---
"@superliora/liora": patch
---

Stop freezes when flinging the transcript from top to bottom: pure-scroll fling frames paint placeholders for cold cards, coalesce scroll paints to the frame budget, and fill real content after the wheel settles.
