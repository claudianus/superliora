---
"@harness-kit/tui-renderer": patch
"@superliora/liora": patch
---

Virtualize the transcript viewport so only visible children are rendered and
painted, keeping frame time roughly constant regardless of conversation length.

Previously `RendererTranscriptViewportComponent.renderWithVisibleRows` rendered
*every* transcript child and then sliced the visible window — the dominant cost
once the conversation grew past a few hundred messages.  `contentRowCount` also
rendered all children, causing a double render per frame.

The viewport now:
- caches per-child row counts keyed by inner width (invalidated on
  `invalidate()` / width change / child count change);
- syncs the viewport from the cached total row count without re-rendering
  unchanged children;
- on overflow, renders and paints only the children whose lines intersect the
  visible `[start, end)` window (the virtual-scroll fast path);
- when content fits the viewport (no overflow), reuses the existing
  prefixed-line cache so unchanged children are not repainted.

This eliminates the double render between `contentRowCount` (height
measurement) and `renderWithVisibleRows` (presentation), and makes scrolling
through long conversations smooth.
