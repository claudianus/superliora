Compare two image files by byte length, sha256, optional PNG IHDR dimensions, and a shared-prefix ratio (MVP — not pixel SSIM).

Use after screenshots or generated assets when you need a cheap “did the image change?” signal. Returns JSON including:

- `identical`, `status` (`identical` | `dimension_mismatch` | `content_changed` | `size_changed`)
- `summary` (one-line human text)
- `left` / `right` meta (`bytes`, `sha256`, optional `width`/`height`, `format`)
- `sharedPrefixRatio`, `lengthDelta`, `note`

Not a perceptual visual regression tool. Prefer VerifySurface for interactive UI acceptance.
