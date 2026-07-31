---
"@superliora/liora": patch
---

Fix `liora upgrade` for GitHub source installs stuck on a dirty working tree. Install no longer fails the dirty pre-check (matches install.sh force-checkout), and the upgrade dialog warns that local changes will be discarded.
