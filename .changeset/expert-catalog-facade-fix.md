---
'@superliora/liora': patch
---

Stop the expert-catalog build script from regenerating the hand-maintained `catalog.ts` facade. The facade only re-exports `catalog-meta` and defines the persona helpers (including `fallbackExpertPersonaText`); regenerating it from a stale inline template deleted that fallback. The build now writes only the data modules (`catalog-meta.ts`, `catalog-personas.json`) and leaves the committed facade untouched.
