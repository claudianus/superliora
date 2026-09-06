---
"@superliora/liora": minor
---

Derive curated gateway model capabilities from models.dev at catalog merge time. Reasoning support, effort ladders, modalities, and tool calling for Command Code (and other curated providers not in models.dev) are now re-read from live models.dev rows instead of a hand-maintained offline snapshot, so models like Muse Spark no longer show up as non-reasoning. Gateway-specific pricing and context limits still come from the curated/live gateway listing, and ids missing from models.dev keep their curated metadata. The OpenRouter live fallback now also maps reasoning support from `supported_parameters` instead of showing every model as non-reasoning while models.dev is down. Model aliases written by older builds get their capability metadata refreshed from the catalog at startup, so existing installs pick up the corrected reasoning flags without reconnecting.
