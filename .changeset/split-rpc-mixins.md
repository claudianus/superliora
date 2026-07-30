---
'@superliora/sdk': patch
---

Split `SDKRpcClientBase` RPC delegation into focused mixin modules (memory, goals/ultrawork, plugins, interactive scope, client API) so `rpc.ts` stays under the LOC budget without changing the public API.
