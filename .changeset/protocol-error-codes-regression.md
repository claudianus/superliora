---
'@superliora/protocol': patch
---

test(protocol): pin protocol/error-codes regression cases

- `ErrorCode.SUCCESS === 0` plus integer-only values.
- `ErrorCode` value namespaces (4 client / 5 daemon / 6 tool).
- `ErrorCodeReason` exposes a non-empty reason for every code value.
- `ErrorCode` / `ErrorCodeReason` shapes are aligned 1:1 by code value.
