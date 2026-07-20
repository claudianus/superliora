---
"@superliora/liora": minor
---

Add `/web <url>`: fetch a URL and view its readable content in the TUI file viewer. HTML is converted to structured plain text (headings, bullets, link annotations, entity decoding, chrome stripped) without a DOM dependency; text-like responses pass through. Fetches time out after 10s and cap at 1MB, and only http(s) URLs are accepted. Aliased as `/fetch`.
