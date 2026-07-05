#!/usr/bin/env bash
# Regenerate welcome-screen mascot ASCII art from external generators.
#
# Requires: figlet, ImageMagick (magick), ascii-image-converter
#   go install github.com/TheZoraiz/ascii-image-converter@latest
#
# Usage: ./scripts/generate-liora-mascot-art.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/liora-mascot-gen"
MAP=' .:-=+*#@'
AIC="${ASCII_IMAGE_CONVERTER:-${HOME}/go/bin/ascii-image-converter}"

mkdir -p "$TMP"

if ! command -v figlet >/dev/null 2>&1; then
  echo "figlet is required" >&2
  exit 1
fi
if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required" >&2
  exit 1
fi
if [[ ! -x "$AIC" ]]; then
  echo "ascii-image-converter not found at $AIC" >&2
  exit 1
fi

magick -size 48x48 xc:black \
  -fill none -stroke white -strokewidth 4 \
  -draw "polygon 24,4 42,14 42,34 24,44 6,34 6,14" \
  -fill white -stroke none -draw "circle 24,24 30,24" \
  "$TMP/base.png"

echo "// Paste into apps/liora/src/tui/components/chrome/liora-mascot-icon.ts"
echo
echo "// PREMIUM_MASCOT_FRAMES — ascii-image-converter 12×6, map \"$MAP\""
echo "export const PREMIUM_MASCOT_FRAMES = ["
for i in 1 2 3 4; do
  glow=$((i * 2))
  magick -size 48x48 xc:black \
    -fill none -stroke "rgb($((180 + glow * 20)),$((180 + glow * 20)),$((180 + glow * 20)))" -strokewidth $((3 + i)) \
    -draw "polygon 24,4 42,14 42,34 24,44 6,34 6,14" \
    -fill "rgb($((200 + glow * 10)),$((200 + glow * 10)),$((200 + glow * 10)))" -stroke none \
    -draw "circle 24,24 $((28 + i)),24" \
    "$TMP/frame-$i.png"
  echo "  ["
  "$AIC" "$TMP/frame-$i.png" -d 12,6 -m "$MAP" | while IFS= read -r line; do
    printf "    %q,\n" "$line"
  done
  echo "  ],"
done
echo "] as const;"
echo
echo "// BANNER_LARGE — figlet Slant SUPERLIORA"
echo "const BANNER_LARGE = ["
figlet -f Slant SUPERLIORA | sed '/^$/d' | while IFS= read -r line; do
  printf "  %q,\n" "$line"
done
echo "] as const;"
echo
echo "// BANNER_COMPACT — figlet Small SUPERLIORA"
echo "const BANNER_COMPACT = ["
figlet -f Small SUPERLIORA | sed '/^$/d' | while IFS= read -r line; do
  printf "  %q,\n" "$line"
done
echo "] as const;"
