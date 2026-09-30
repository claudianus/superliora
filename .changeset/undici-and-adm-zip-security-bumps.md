---
"@superliora/liora": patch
---

Pick up two dependency security fixes. `undici`, the HTTP and WebSocket client, moves to 7.30.0, which covers a TLS certificate validation bypass and several denial-of-service paths. `adm-zip` moves to 0.6.1 through the existing override; it arrives transitively through the browser automation and ML runtime packages, both of which unpack downloaded archives, so its decompression-bomb and privilege-escalation advisories were reachable rather than theoretical.
