---
"@superliora/liora": patch
---

Harden the Devin (account login) model picker. Live `GetCliModelConfigs` discovery now gets a 15s budget with one retry instead of a single 5s shot, and when discovery still misses, the picker shows a notice that it's displaying the built-in seed list rather than silently opening with only 3 models. Re-login now defaults to "Refresh current account" in the account-action prompt instead of "Add another account".
