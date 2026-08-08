---
"@superliora/liora": patch
---

Fix Conductor merge landing and wake every exceptional Job status (blocked/failed/cancelled/interrupted/needs_user/done) through one inbox+wake path so the Conductor can respond.
