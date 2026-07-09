---
"@superliora/liora": patch
---

Harden the URL fetcher against SSRF and close a credential-leak gap in auto/yolo permission modes. The fetcher now resolves hostnames and blocks any that resolve to a private address (DNS-rebinding defense), re-validates every redirect hop, and rejects URLs with embedded credentials. Sensitive files such as `~/.ssh/`, `~/.gnupg/`, `~/.kube/config`, `~/.docker/config.json`, and `~/.aws/config` are now hard-blocked under auto and yolo modes instead of only asking.
