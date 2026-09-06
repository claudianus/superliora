from pathlib import Path

edits = [
  (
    "packages/agent-core/test/agent/kosong-llm.test.ts",
    "    image_in: false,\n    video_in: false,\n    audio_in: false,\n    thinking: false,",
    "    image_in: false,\n    video_in: false,\n    audio_in: false,\n    pdf_in: false,\n    thinking: false,",
  ),
  (
    "packages/agent-core/test/agent/compaction/full.test.ts",
    "  image_in: true,\n  video_in: true,\n  audio_in: false,\n  thinking: true,",
    "  image_in: true,\n  video_in: true,\n  audio_in: false,\n  pdf_in: false,\n  thinking: true,",
  ),
  (
    "packages/agent-core/test/agent/turn.test.ts",
    "    image_in: true,\n    video_in: true,\n    audio_in: false,\n    thinking: false,",
    "    image_in: true,\n    video_in: true,\n    audio_in: false,\n    pdf_in: false,\n    thinking: false,",
  ),
]

for path, old, new in edits:
    p = Path(path)
    text = p.read_text()
    if "pdf_in" in text:
        print("already has pdf_in:", path)
        continue
    if old not in text:
        raise SystemExit(f"pattern not found in {path}")
    if text.count(old) != 1:
        raise SystemExit(f"pattern not unique in {path}: {text.count(old)}")
    p.write_text(text.replace(old, new, 1))
    print("patched", path, "bytes", p.stat().st_size)
