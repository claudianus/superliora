---
"@superliora/liora": minor
---

Add multi-account OAuth login so quota/rate-limit failures can auto-switch across a credential pool.

- `liora login --add [--label …]` allocates a fresh OAuth storage key and keeps existing accounts as fallbacks
- TUI `/login` offers "Add another account" when already signed in
- Existing provider route failover cools down exhausted accounts and retries the next candidate
