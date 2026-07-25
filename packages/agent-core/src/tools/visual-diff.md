Compare two image files by byte length and sha256 (MVP — not pixel SSIM).

Use after screenshots or generated assets when you need a cheap “did the pixels change?” signal. Returns JSON: `{ identical, leftBytes, rightBytes, leftSha256, rightSha256, lengthDelta, note }`.

Not a perceptual visual regression tool. Prefer VerifySurface for interactive UI acceptance.
