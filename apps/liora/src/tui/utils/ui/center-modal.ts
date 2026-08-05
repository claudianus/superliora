/**
 * Center-modal stack + overlay region bridge.
 *
 * Product dialogs float over the stage via `createRendererOverlayPanelRegion`
 * (`placement: 'center'`). Input is captured with `pushLegacyModalTarget`.
 */

import {
  createRendererOverlayPanelRegion,
  type Component,
  type Focusable,
  type RendererFrameRegion,
  type RendererRect,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

export const CENTER_MODAL_REGION_ID = 'liora-center-modal';
export const CENTER_MODAL_Z_INDEX = 8_000;
/** Wide Command Hub / Settings ceiling; viewport still wins via centerModalContentWidth. */
export const CENTER_MODAL_MAX_WIDTH = 120;
export const CENTER_MODAL_MARGIN = 2;

export interface CenterModalEntry {
  readonly id: string;
  readonly panel: Component & Focusable;
  readonly disposeInput: () => void;
  /** Short breadcrumb segment, e.g. "Hub", "Settings". */
  readonly label?: string;
}

export type CenterModalMountMode = 'push' | 'replace';

export interface CenterModalMountOptions {
  readonly mode?: CenterModalMountMode;
  readonly label?: string;
}

/** Preferred content width for a center modal in the given viewport. */
export function centerModalContentWidth(viewportWidth: number): number {
  return Math.max(24, Math.min(CENTER_MODAL_MAX_WIDTH, viewportWidth - CENTER_MODAL_MARGIN * 2));
}

/**
 * Render the top center-modal panel into a compositor overlay region.
 * Panel chrome is owned by the panel itself — overlay border is off.
 */
export function createCenterModalOverlayRegion(
  stack: readonly CenterModalEntry[],
  viewport: RendererRect,
): RendererFrameRegion | undefined {
  const top = stack.at(-1);
  if (top === undefined) return undefined;
  if (viewport.width <= 0 || viewport.height <= 0) return undefined;

  const width = centerModalContentWidth(viewport.width);
  const maxHeight = Math.max(4, viewport.height - CENTER_MODAL_MARGIN * 2);
  const panelLines = top.panel.render(width);
  const crumb = centerModalBreadcrumb(stack);
  const lines =
    crumb === undefined
      ? panelLines
      : [currentTheme.fg('textMuted', ` ${crumb}`), ...panelLines];
  const palette = currentTheme.palette;
  const panelBg = currentTheme.canvasBackgroundEnabled ? palette.surfaceRaised : undefined;

  return createRendererOverlayPanelRegion({
    id: CENTER_MODAL_REGION_ID,
    viewport: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    lines,
    placement: 'center',
    width,
    maxWidth: width,
    maxHeight,
    marginX: CENTER_MODAL_MARGIN,
    marginY: CENTER_MODAL_MARGIN,
    zIndex: CENTER_MODAL_Z_INDEX,
    border: false,
    style: {
      container: panelBg === undefined ? undefined : { bg: panelBg },
      body: { fg: palette.text },
    },
    background:
      panelBg === undefined
        ? undefined
        : { char: ' ', style: { bg: panelBg } },
  });
}

/** `Hub › Settings › Model` when nested center modals carry labels. */
export function centerModalBreadcrumb(stack: readonly CenterModalEntry[]): string | undefined {
  const labels = stack
    .map((entry) => entry.label?.trim())
    .filter((label): label is string => label !== undefined && label.length > 0);
  if (labels.length < 2) return undefined;
  return labels.join(' › ');
}
