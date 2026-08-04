---
"@superliora/liora": patch
---

Fix SearchSkill returning no results when the CLI runs from its built bundle, where the skill catalog path no longer resolves. Skill catalog lookup now also checks the repo checkout layout and a SUPERLIORA_SKILL_CATALOG_DIR override.
