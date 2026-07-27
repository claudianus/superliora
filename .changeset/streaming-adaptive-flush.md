---
'@superliora/liora': patch
---

Make the streaming UI flush throttle adaptive: sustained token/argument bursts coalesce repaints with a bounded window (50ms floor, 80ms ceiling) while light traffic keeps the base cadence, and semantic boundaries (turn end, tool start/result) still flush immediately.
