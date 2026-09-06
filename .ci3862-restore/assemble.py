import base64, hashlib, json, pathlib
manifest = json.loads(pathlib.Path(".ci3862-restore/manifest.json").read_text())
for item in manifest:
    parts = [pathlib.Path(p).read_text().strip() for p in item["parts"]]
    raw = base64.b64decode("".join(parts))
    md5 = hashlib.md5(raw).hexdigest()
    assert md5 == item["md5"], (item["dest"], md5, item["md5"])
    assert len(raw) == item["bytes"]
    dest = pathlib.Path(item["dest"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    print("restored", item["dest"], len(raw), md5)
