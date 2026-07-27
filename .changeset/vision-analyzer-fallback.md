---
'@superliora/liora': minor
---

Add a vision analyzer smart fallback for text-only chat models.

When the current model cannot consume attached images/videos but the account
has a vision-capable model with credentials, SuperLiora now analyzes the
media with that model and sends the description instead of blocking the
prompt. Selection prefers the current model's provider, then catalog order.
A new `media.nonVisionFallback` setting (`analyze` default, `path`, `block`)
controls the behavior; the TUI settings menu exposes it, relaxes the
pre-send gate accordingly, and toasts when media was analyzed. ReadMediaFile
routes through the same analyzer instead of refusing on text-only models.
Models with unknown capabilities stay fail-open (no transform).
