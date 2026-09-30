---
"@superliora/liora": minor
---

Report an edit that breaks the file's syntax in the same tool result that made it. A malformed edit used to stay silent until the next build or test run, and because the file no longer parsed, every later command failed on the same first error while the model spent turns rediscovering it. Edit, Write, and ApplyPatch now append the position and message of the parse error. The check is a parse only, not a type check, and costs about 35µs on a typical source file; a plugin language server still takes precedence and adds type diagnostics on top.
