---
"@superliora/liora": patch
---

Stop re-parsing every recorded tool call's arguments on each Anthropic request, which cost time proportional to the size of the largest Write/Edit calls in the conversation.