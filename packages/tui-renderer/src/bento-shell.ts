import type { RendererRect } from './compositor';
import {
  type BentoGridCell,
  type BentoGridLayout,
  type BentoPanelSpec,
  type WorkspaceLayoutMode,
  hitTestBentoGrid,
  resolveBentoGridSize,
} from './workspace-layout';

// ---------------------------------------------------------------------------
// Shell bento — prescribed CSS-grid-style templates for the full TUI surface
// ---------------------------------------------------------------------------

export type ShellBentoCellId =
  | 'header'
  | 'transcript'
  | 'editor'
  | 'footer'
  | 'rail'
  | 'activity'
  | 'todo'
  | 'queue'
  | 'btw'
  | `panel:${string}`;

export type ShellBentoChromeId = Extract<
  ShellBentoCellId,
  'header' | 'transcript' | 'editor' | 'footer' | 'rail' | 'activity' | 'todo' | 'queue' | 'btw'
>;

export interface ShellBentoChromeBudget {
  readonly header: number;
  readonly footer: number;
  readonly editor: number;
  /** Combined situational rail height budget when rail mode is active. */
  readonly rail?: number;
  readonly activity?: number;
  readonly todo?: number;
  readonly queue?: number;
  readonly btw?: number;
}

export interface ShellBentoOptions {
  readonly viewport: RendererRect;
  readonly mode: WorkspaceLayoutMode;
  /** Natural row budgets for chrome tiles (0 = absent). */
  readonly chrome: ShellBentoChromeBudget;
  /** Left-dock panel specs (already filtered to visible dock). */
  readonly leftPanels?: readonly BentoPanelSpec[];
  /** Right-dock panel specs. */
  readonly rightPanels?: readonly BentoPanelSpec[];
  /** Left dock column width when panels present. */
  readonly leftDockWidth?: number;
  /** Right dock column width when panels present. */
  readonly rightDockWidth?: number;
  /** Gap between tiles (cells). @default 1 */
  readonly gap?: number;
  /** Shell inset from viewport edges. */
  readonly insetX?: number;
  readonly insetY?: number;
  readonly focusedId?: string | null;
  /**
   * When true, situational panels (activity/todo/queue/btw) sit in a right
   * rail beside the transcript instead of stacking under it.
   */
  readonly railMode?: boolean;
}

export interface ShellBentoLayout {
  readonly mode: WorkspaceLayoutMode;
  readonly gap: number;
  readonly area: RendererRect;
  /** Full named-cell map (chrome + panels). */
  readonly cells: ReadonlyMap<ShellBentoCellId, BentoGridCell>;
  /** Ordered paint list (back → front). */
  readonly paintOrder: readonly BentoGridCell[];
  /** Center content band (transcript column, excluding docks). */
  readonly center: RendererRect;
  readonly leftDock?: RendererRect;
  readonly rightDock?: RendererRect;
  /** Convenience grid for dock-only hit testing / legacy callers. */
  readonly dockGrid: BentoGridLayout | null;
}

const DEFAULT_GAP = 1;
const MIN_TRANSCRIPT_ROWS = 4;
const MIN_EDITOR_ROWS = 2;

function insetRect(rect: RendererRect, ix: number, iy: number): RendererRect {
  const xInset = Math.max(0, Math.min(ix, Math.floor((rect.width - 1) / 2)));
  const yInset = Math.max(0, Math.min(iy, Math.floor((rect.height - 1) / 2)));
  return {
    x: rect.x + xInset,
    y: rect.y + yInset,
    width: Math.max(1, rect.width - xInset * 2),
    height: Math.max(1, rect.height - yInset * 2),
  };
}

function cell(
  id: ShellBentoCellId,
  rect: RendererRect,
  focusedId: string | null | undefined,
  col = 0,
  row = 0,
  colSpan = 1,
  rowSpan = 1,
  priority = 0,
): BentoGridCell {
  return {
    id,
    col,
    row,
    colSpan,
    rowSpan,
    priority,
    rect,
    focused: focusedId === id,
  };
}

function splitHorizontal(
  area: RendererRect,
  widths: readonly number[],
  gap: number,
): RendererRect[] {
  const rects: RendererRect[] = [];
  let x = area.x;
  for (let i = 0; i < widths.length; i++) {
    const w = Math.max(0, widths[i]!);
    if (w > 0) {
      rects.push({ x, y: area.y, width: w, height: area.height });
      x += w + (i < widths.length - 1 ? gap : 0);
    } else {
      rects.push({ x, y: area.y, width: 0, height: area.height });
    }
  }
  return rects;
}

function splitVertical(
  area: RendererRect,
  heights: readonly number[],
  gap: number,
): RendererRect[] {
  const rects: RendererRect[] = [];
  let y = area.y;
  for (let i = 0; i < heights.length; i++) {
    const h = Math.max(0, heights[i]!);
    if (h > 0) {
      rects.push({ x: area.x, y, width: area.width, height: h });
      y += h + (i < heights.length - 1 ? gap : 0);
    } else {
      rects.push({ x: area.x, y, width: area.width, height: 0 });
    }
  }
  return rects;
}

function clampDockWidth(requested: number, available: number, minCenter: number, gap: number): number {
  if (requested <= 0) return 0;
  const max = Math.max(0, available - minCenter - gap);
  return Math.min(requested, max);
}

/**
 * Measure a full-terminal bento shell with prescribed named areas.
 *
 * Templates by mode:
 * ```
 * ┌──────────── header (full width) ────────────┐
 * │ left │ transcript [| rail] │ right │
 * │ dock │ editor              │ dock  │
 * └──────────── footer (full width) ────────────┘
 * ```
 * Narrow / compact / micro collapse to a single column (no docks).
 */
export function measureShellBentoLayout(options: ShellBentoOptions): ShellBentoLayout {
  const gap = options.gap ?? DEFAULT_GAP;
  const focusedId = options.focusedId ?? null;
  const area = insetRect(options.viewport, options.insetX ?? 0, options.insetY ?? 0);
  const chrome = options.chrome;
  const leftPanels = options.leftPanels ?? [];
  const rightPanels = options.rightPanels ?? [];
  const railMode = options.railMode === true;

  const wantsLeft =
    (options.mode === 'wide' || options.mode === 'ultrawide') && leftPanels.length > 0;
  const wantsRight =
    (options.mode === 'wide' ||
      options.mode === 'ultrawide' ||
      options.mode === 'medium') &&
    rightPanels.length > 0;

  const minCenter =
    options.mode === 'micro' ? 20 : options.mode === 'compact' ? 40 : 68;

  let leftW = wantsLeft
    ? clampDockWidth(options.leftDockWidth ?? 42, area.width, minCenter, gap)
    : 0;
  let rightW = wantsRight
    ? clampDockWidth(options.rightDockWidth ?? 52, area.width - leftW, minCenter, gap)
    : 0;
  if (wantsLeft && leftW > 0) {
    leftW = clampDockWidth(leftW, area.width - rightW, minCenter, gap);
  }

  const cells = new Map<ShellBentoCellId, BentoGridCell>();
  const paintOrder: BentoGridCell[] = [];
  const push = (c: BentoGridCell) => {
    if (c.rect.width <= 0 || c.rect.height <= 0) return;
    cells.set(c.id as ShellBentoCellId, c);
    paintOrder.push(c);
  };

  const headerH = Math.max(0, chrome.header);
  const footerH = Math.max(0, chrome.footer);
  const editorH = Math.max(chrome.editor > 0 ? Math.max(MIN_EDITOR_ROWS, chrome.editor) : 0, 0);

  const situationalHeights = !railMode
    ? [chrome.activity ?? 0, chrome.todo ?? 0, chrome.queue ?? 0, chrome.btw ?? 0]
    : [0, 0, 0, 0];
  const situationalTotal = situationalHeights.reduce((a, b) => a + b, 0);
  const situationalCount = situationalHeights.filter((h) => h > 0).length;

  // Full-width header / footer; docks live only in the middle band.
  const shellVerticalTiles =
    (headerH > 0 ? 1 : 0) + 1 /* middle */ + (footerH > 0 ? 1 : 0);
  const shellGaps = Math.max(0, shellVerticalTiles - 1) * gap;
  const middleH = Math.max(
    MIN_TRANSCRIPT_ROWS + (editorH > 0 ? editorH + gap : 0),
    area.height - headerH - footerH - shellGaps,
  );

  const shellHeights: number[] = [];
  if (headerH > 0) shellHeights.push(headerH);
  shellHeights.push(middleH);
  if (footerH > 0) shellHeights.push(footerH);
  const shellRects = splitVertical(area, shellHeights, gap);

  let shellIdx = 0;
  if (headerH > 0) {
    push(cell('header', shellRects[shellIdx++]!, focusedId, 0, 0, 3, 1, 80));
  }
  const middleBand = shellRects[shellIdx++]!;
  // Footer pushed after middle content so paint order keeps chrome coherent.
  const footerRect = footerH > 0 ? shellRects[shellIdx++] : undefined;

  // Middle: left | center | right
  const colGaps = (leftW > 0 ? 1 : 0) + (rightW > 0 ? 1 : 0);
  const centerW = Math.max(1, middleBand.width - leftW - rightW - gap * colGaps);
  const [leftRect, centerBand, rightRect] = splitHorizontal(
    middleBand,
    [leftW, centerW, rightW],
    gap,
  );

  // Center column inside middle: transcript → situational → editor
  const centerGaps =
    Math.max(
      0,
      (1 + situationalCount + (editorH > 0 ? 1 : 0) - 1),
    ) * gap;
  const transcriptBandH = Math.max(
    MIN_TRANSCRIPT_ROWS,
    centerBand!.height - editorH - situationalTotal - centerGaps,
  );

  type StackEntry = { id: ShellBentoCellId; height: number };
  const stack: StackEntry[] = [{ id: 'transcript', height: transcriptBandH }];
  if (!railMode) {
    if ((chrome.activity ?? 0) > 0) stack.push({ id: 'activity', height: chrome.activity! });
    if ((chrome.todo ?? 0) > 0) stack.push({ id: 'todo', height: chrome.todo! });
    if ((chrome.queue ?? 0) > 0) stack.push({ id: 'queue', height: chrome.queue! });
    if ((chrome.btw ?? 0) > 0) stack.push({ id: 'btw', height: chrome.btw! });
  }
  if (editorH > 0) stack.push({ id: 'editor', height: editorH });

  const stackRects = splitVertical(
    centerBand!,
    stack.map((s) => s.height),
    gap,
  );

  for (let i = 0; i < stack.length; i++) {
    const entry = stack[i]!;
    const rect = stackRects[i]!;

    if (entry.id === 'transcript' && railMode) {
      const railWidth = Math.min(36, Math.max(24, Math.floor(rect.width * 0.28)));
      const mainWidth = Math.max(1, rect.width - railWidth - gap);
      if (mainWidth + railWidth + gap <= rect.width) {
        const [mainRect, railRect] = splitHorizontal(rect, [mainWidth, railWidth], gap);
        push(cell('transcript', mainRect!, focusedId, 1, i, 1, 1, 100));
        push(cell('rail', railRect!, focusedId, 2, i, 1, 1, 40));
        continue;
      }
    }

    const priority =
      entry.id === 'transcript' ? 100 :
      entry.id === 'editor' ? 90 :
      50;
    push(cell(entry.id, rect, focusedId, 1, i, 1, 1, priority));
  }

  if (footerRect) {
    push(cell('footer', footerRect, focusedId, 0, 2, 3, 1, 80));
  }

  // Docks only in the middle band (below header, above footer)
  if (leftW > 0 && leftRect && leftRect.width > 0) {
    placeDockPanels(leftRect, leftPanels, focusedId, gap, push);
  }
  if (rightW > 0 && rightRect && rightRect.width > 0) {
    placeDockPanels(rightRect, rightPanels, focusedId, gap, push);
  }

  const dockCells = paintOrder.filter((c) => c.id.startsWith('panel:'));
  const dockGrid: BentoGridLayout | null =
    dockCells.length > 0
      ? {
          columns: resolveBentoGridSize(area.width).columns,
          rows: resolveBentoGridSize(area.width).rows,
          cells: dockCells,
          gap,
          area,
        }
      : null;

  return {
    mode: options.mode,
    gap,
    area,
    cells,
    paintOrder,
    center: centerBand!,
    leftDock: leftW > 0 ? leftRect : undefined,
    rightDock: rightW > 0 ? rightRect : undefined,
    dockGrid,
  };
}

function placeDockPanels(
  dockRect: RendererRect,
  panels: readonly BentoPanelSpec[],
  focusedId: string | null,
  gap: number,
  push: (c: BentoGridCell) => void,
): void {
  if (panels.length === 0) return;

  // Single panel: full dock
  if (panels.length === 1) {
    const p = panels[0]!;
    push(cell(`panel:${p.id}`, dockRect, focusedId, 0, 0, 1, 1, p.priority));
    return;
  }

  // Two panels: Git-biased vertical split (diff lists run long; file trees
  // are denser). Zero gap so closed frames abut; omitBottom removes upper ╰.
  if (panels.length === 2) {
    const splitGap = 0;
    const h0 = Math.max(3, Math.floor((dockRect.height - splitGap) * 0.45));
    const h1 = Math.max(3, dockRect.height - splitGap - h0);
    const [r0, r1] = splitVertical(dockRect, [h0, h1], splitGap);
    push(cell(`panel:${panels[0]!.id}`, r0!, focusedId, 0, 0, 1, 1, panels[0]!.priority));
    push(cell(`panel:${panels[1]!.id}`, r1!, focusedId, 0, 1, 1, 1, panels[1]!.priority));
    return;
  }

  // 3+: use greedy grid inside the dock
  const { columns, rows } = resolveBentoGridSize(dockRect.width);
  // Prefer vertical stack for tall docks with few columns
  if (columns <= 1 || panels.length <= 3) {
    const n = panels.length;
    const totalGap = gap * (n - 1);
    const each = Math.max(1, Math.floor((dockRect.height - totalGap) / n));
    const heights = panels.map((_, i) =>
      i === n - 1 ? dockRect.height - (each + gap) * (n - 1) : each,
    );
    const rects = splitVertical(dockRect, heights, gap);
    panels.forEach((p, i) => {
      push(cell(`panel:${p.id}`, rects[i]!, focusedId, 0, i, 1, 1, p.priority));
    });
    return;
  }

  // Fall back to equal grid cells
  const cellW = Math.floor((dockRect.width - gap * (columns - 1)) / columns);
  const cellH = Math.floor((dockRect.height - gap * (rows - 1)) / rows);
  let placed = 0;
  for (let row = 0; row < rows && placed < panels.length; row++) {
    for (let col = 0; col < columns && placed < panels.length; col++) {
      const p = panels[placed]!;
      const rect: RendererRect = {
        x: dockRect.x + col * (cellW + gap),
        y: dockRect.y + row * (cellH + gap),
        width: cellW,
        height: cellH,
      };
      push(cell(`panel:${p.id}`, rect, focusedId, col, row, 1, 1, p.priority));
      placed++;
    }
  }
}

export function getShellBentoCell(
  layout: ShellBentoLayout,
  id: ShellBentoCellId,
): BentoGridCell | undefined {
  return layout.cells.get(id);
}

export function hitTestShellBento(
  layout: ShellBentoLayout,
  x: number,
  y: number,
): { cellId: string; cell: BentoGridCell } | null {
  // Paint order is back→front; hit-test front→back
  for (let i = layout.paintOrder.length - 1; i >= 0; i--) {
    const c = layout.paintOrder[i]!;
    const r = c.rect;
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
      return { cellId: c.id, cell: c };
    }
  }
  if (layout.dockGrid) return hitTestBentoGrid(layout.dockGrid, x, y);
  return null;
}

/** Content rect inside a framed tile (1-cell border on each side). */
export function shellBentoContentRect(tile: RendererRect): RendererRect {
  return {
    x: tile.x + 1,
    y: tile.y + 1,
    width: Math.max(0, tile.width - 2),
    height: Math.max(0, tile.height - 2),
  };
}
