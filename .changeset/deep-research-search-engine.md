---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Upgrade WebSearch into a multi-provider deep-research engine with cost-aware cascade (default): cheapest ready provider first, hard paid-call budget, free DuckDuckGo last, env auto-detect for Brave/Tavily/Exa/Serper, and easy key signup hints in /status.

Hard efficiency guards: no paid fan-out by default, include_content fetches only top 1–2 cleaned bodies after ranking (cap chars), Tavily/Exa stay on cheap metadata mode, free stack is intent-aware (parallel tech sources, skip wasteful APIs on general queries).
