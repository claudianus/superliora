---
"@superliora/liora": minor
---

Add Korean language support for CLI help text and runtime messages. On Korean system locales, `liora --help`, subcommand help, and user-facing stderr/stdout output (errors, upgrade prompts, login flow, server status, provider commands, and more) render in Korean. Set `SUPERLIORA_LOCALE=ko` (or any `ko*` `LANG`/`LC_ALL`) to force Korean, or `SUPERLIORA_LOCALE=en` to keep English.
