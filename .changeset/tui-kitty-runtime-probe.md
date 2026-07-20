---
"@superliora/liora": minor
---

Detect kitty graphics support at startup with the protocol's official `a=q` query plus a DA1 sentinel, so inline image previews work in kitty-capable terminals that environment detection misses (SSH sessions, WezTerm with `enable_kitty_graphics`, Konsole, Zed). Add `SUPERLIORA_IMAGE_PROTOCOL=kitty|iterm2|none` as an explicit override, and show the probe outcome in `/term`.
