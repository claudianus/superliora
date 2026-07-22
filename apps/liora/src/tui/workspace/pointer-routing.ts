import type { RendererRect, WorkspaceLayoutResult } from '@harness-kit/tui-renderer';

import type { PanelManager } from './panel-manager';

// ---------------------------------------------------------------------------
// Rect utilities
// ---------------------------------------------------------------------------

export function isInsideRect(x: number, y: number, rect: RendererRect): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** Index of the panel stacked at row `y` within a dock rect (even split across `panelCount`). */
export function getPanelIndexAtY(y: number, dockRect: RendererRect, panelCount: number): number {
  if (panelCount === 0) return 0;
  const panelHeight = Math.floor(dockRect.height / panelCount);
  const relY = y - dockRect.y;
  return Math.min(Math.floor(relY / panelHeight), panelCount - 1);
}

/**
 * Index of the panel whose title-bar row (row 0 of its stacked slot) contains
 * (x, y), or null if the point isn't on a title row. Spans the full dock
 * width — any x inside the dock rect counts, not just the title glyph span.
 */
export function hitTestDockPanels(
  x: number,
  y: number,
  dockRect: RendererRect | undefined,
  panelCount: number,
): number | null {
  if (!dockRect || panelCount === 0) return null;
  if (!isInsideRect(x, y, dockRect)) return null;

  const panelHeight = Math.floor(dockRect.height / panelCount);
  const relY = y - dockRect.y;
  const panelIndex = Math.floor(relY / panelHeight);
  const withinPanel = relY - panelIndex * panelHeight;

  if (withinPanel === 0 && panelIndex < panelCount) {
    return panelIndex;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Panel hit-testing (dock-aware)
// ---------------------------------------------------------------------------

/** Instance id of the panel whose title-bar row contains (x, y), across both docks. */
export function hitTestPanelTitleBarAt(
  layout: WorkspaceLayoutResult,
  panelManager: PanelManager,
  x: number,
  y: number,
): string | null {
  const leftPanels = panelManager.getPanelsInDock('left');
  const leftIndex = hitTestDockPanels(x, y, layout.leftDock?.rect, leftPanels.length);
  if (leftIndex !== null) return leftPanels[leftIndex]?.instanceId ?? null;

  const rightPanels = panelManager.getPanelsInDock('right');
  const rightIndex = hitTestDockPanels(x, y, layout.rightDock?.rect, rightPanels.length);
  if (rightIndex !== null) return rightPanels[rightIndex]?.instanceId ?? null;

  return null;
}

/** Instance id of the panel whose body contains (x, y), across both docks. */
export function hitTestPanelAt(
  layout: WorkspaceLayoutResult,
  panelManager: PanelManager,
  x: number,
  y: number,
): string | null {
  if (layout.leftDock && isInsideRect(x, y, layout.leftDock.rect)) {
    const panels = panelManager.getPanelsInDock('left');
    const index = getPanelIndexAtY(y, layout.leftDock.rect, panels.length);
    return panels[index]?.instanceId ?? null;
  }

  if (layout.rightDock && isInsideRect(x, y, layout.rightDock.rect)) {
    const panels = panelManager.getPanelsInDock('right');
    const index = getPanelIndexAtY(y, layout.rightDock.rect, panels.length);
    return panels[index]?.instanceId ?? null;
  }

  return null;
}

/**
 * Resolve which panel a wheel event over a dock should scroll: the panel
 * under the pointer, not merely the focused one.
 */
export function resolveWheelTargetPanel(
  layout: WorkspaceLayoutResult,
  panelManager: PanelManager,
  x: number,
  y: number,
): string | null {
  return hitTestPanelAt(layout, panelManager, x, y);
}
