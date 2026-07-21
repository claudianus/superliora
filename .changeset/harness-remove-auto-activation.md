---
'@superliora/liora': minor
---

Remove the pre-agent Ultrawork auto-activation router: natural-language prompts now go straight to the main agent instead of passing through a separate LLM classifier that could silently switch the session into Ultrawork mode. The agent decides for itself when to reach for UltraSwarm/UltraPlan tooling from tool descriptions and conversation context, and explicit `/ultrawork` activation (including the ultrawork mode toggle) is unchanged. This also drops the per-prompt classifier round trip.
