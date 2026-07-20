---
'@superliora/liora': minor
---

Open the situational rail at 120 columns instead of 128: the stage narrows to `cols − 38` so the fixed-width activity/TODO rail always fits on `wide` terminals, and rail sections (todo → activity → queue → btw) are separated by blank divider rows with empty sections omitted. Terminals below 120 columns, tiny profiles, and rail-less states keep the full-bleed vertical stack unchanged.
