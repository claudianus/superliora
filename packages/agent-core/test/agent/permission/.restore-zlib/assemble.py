#!/usr/bin/env python3
"""Inflate staged zlib halves into packages/agent-core/test/agent/permission.test.ts."""
from __future__ import annotations
import base64, hashlib, zlib
from pathlib import Path
HERE = Path(__file__).resolve().parent
AGENT = HERE.parents[1]
a = (HERE / "a.b64").read_text().strip()
b = (HERE / "b.b64").read_text().strip()
# Repair known single-character corruptions from prior MCP uploads (verified locally).
if hashlib.sha256(b.encode()).hexdigest() == "a2691baa1535759f7c4ddff90e7159ab8486f4c7e16ecca0377e80042200fb4b":
    bl = list(b)
    bl[6675] = "b"
    bl[11258] = "v"
    b = "".join(bl)
blob = a + b
raw = zlib.decompress(base64.b64decode(blob.encode("ascii")))
assert len(raw) == 156301
assert hashlib.sha256(raw).hexdigest() == "746ed14ed5af0684881eb457cfd1519c7a798fb846edf54ad6efdad8dedf590b"
out = AGENT / "permission.test.ts"
out.write_bytes(raw)
print(f"wrote {out} ({len(raw)} bytes)")
