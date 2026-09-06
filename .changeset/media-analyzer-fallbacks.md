---
'@superliora/liora': minor
---

Add per-kind analyzer fallback lists with call-time failover.

`media.analyzer_fallbacks` accepts an ordered model-alias list per media kind
(image/video/audio/pdf). Analyzer selection now tries the configured primary
alias, then each fallback, then automatic catalog selection, and a failed or
empty analyzer call moves to the next candidate instead of degrading the
attachment immediately. ReadMediaFile routes PDFs through the same analyzer
fallback instead of refusing on text-only models, and the session emits a
`vision_analyzer.path_only` warning (with a TUI notice) when attachments
finally degrade to path notes.
