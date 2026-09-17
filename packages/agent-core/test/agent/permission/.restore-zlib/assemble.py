#!/usr/bin/env python3
"""Inflate staged zlib halves into packages/agent-core/test/agent/permission.test.ts."""
from __future__ import annotations
import base64, hashlib, zlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
parts_dir = ROOT / "permission" / ".restore-zlib"
blob = (parts_dir / "a.b64").read_text().strip() + (parts_dir / "b.b64").read_text().strip()
raw = zlib.decompress(base64.b64decode(blob.encode("ascii")))
assert len(raw) == 156301
assert hashlib.sha256(raw).hexdigest() == "746ed14ed5af0684881eb457cfd1519c7a798fb846edf54ad6efdad8dedf590b"
out = ROOT / "permission.test.ts"
out.write_bytes(raw)
print(f"wrote {out} ({len(raw)} bytes)")
