---
"@superliora/liora": minor
---

Rework the UltraPlan interview to reduce question fatigue and sharpen intent capture. The agent now auto-answers factual questions from code (RecordInterviewFinding) and reserves AskUserQuestion for real decisions. A rhythm guard forces a user check-in after three consecutive auto-answers, a restate gate confirms the goal before advancing, and the round cap offers a safe-default escape.
