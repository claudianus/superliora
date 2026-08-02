---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Plain Goal complete is hard-rejected when PostToolUse sensors still show sticky check failures (`sensor_verification_failed`) or unverified Edit/Write/ApplyPatch mutations (`sensor_mutation_unverified`). Soft tips alone no longer allow false-done; runtime/system finish paths stay exempt.
