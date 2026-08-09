---
"@superliora/liora": patch
---

Harden provider failover: walk the full fallbackModels chain, classify all-candidates-cooling-down by auth/quota (no useless rate-limit sleeps), and cool mid-stream failures so the next attempt can switch.
