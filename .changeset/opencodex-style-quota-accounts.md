---
'@superliora/oauth': minor
'@superliora/sdk': patch
'@superliora/liora': patch
---

Make `/quota` (Q overlay, `/usage` and the footer chip) show real per-account subscription quota the way opencodex's account-pool dashboard does:

- **OpenAI Codex / ChatGPT** — the WHAM usage client now classifies windows by their declared duration instead of payload order: a sub-day primary is a burst (5-hour) bar, a ≥28-day window is the monthly/30-day bar (Go/Free plans report 30-day only), and everything else is the weekly bar. It also surfaces the account plan (`plus`, `pro`, `go`, …) and account email.
- **xAI Grok (Build)** — probes the `cli-chat-proxy.grok.com/v1/billing?format=credits` weekly-credits window (the number that actually gates prompting) with the `x-userid` claim from the OAuth JWT; the monthly dollar envelope and the old response-header probe remain as fallbacks, and the public `api.x.ai` route keeps the header probe.
- **Account pools** — `getAllProvidersUsage` now fetches quota for every OAuth account in a provider pool (each labeled, `primary` marked) instead of only the first account, with the route-limit overlay and the TUI quota panel preserving each account's own rows and bars.
