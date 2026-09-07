---
"@superliora/liora": patch
---

Break the job-worker blocked → resume → replace loop: the spawn progress stall window now exceeds the LLM idle timeout so workers waiting on a slow model are no longer falsely flagged as stalled, and conductor wakes coalesce per unread inbox set so a burst of job notices triggers one routing turn instead of one per notice, while genuinely new notices still wake the conductor immediately.
