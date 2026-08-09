---
'@superliora/liora': patch
'@superliora/agent-core': patch
---

Smart auto model routing skips quota-exhausted providers when pinning loop roles.

Command Hub → Model routing → Smart auto now clears role overrides and pins only healthy aliases (credential health / usage-quota bridge). Exhausted token-plan providers such as qwen-token-plan are never written into loopControl.*Model when a healthy alternative exists; roles without a healthy candidate are skipped with a status toast.
