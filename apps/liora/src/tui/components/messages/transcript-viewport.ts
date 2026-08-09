import { type TranscriptViewportState } from '#/tui/features/transcript/transcript-viewport';
import {
  RendererTranscriptViewportComponent,
  visibleWidth,
  withTranscriptMeasureMode,
  type Component,
  type RendererScrollbarGlyphRole,
} from '#/tui/renderer';

import {
  IdleStageComponent,
  isEmptyTranscriptChrome,
} from '#/tui/components/chrome/idle-stage';
import { currentTheme } from '#/tui/theme';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render/render-cache';

/**
 * Capsule scrollbar glyphs — soft track, rounded thumb ends, edge cues.
 * Colors come from the live theme via paintScrollbarGlyph.
 */
const TRANSCRIPT_SCROLLBAR_TRACK = '┊';
const TRANSCRIPT_SCROLLBAR_THUMB = '█';

export class TranscriptViewportComponent extends RendererTranscriptViewportComponent {
  private readonly resolveVisibleRows: (width: number) => number;
  /** Prior transcript children while `/aquarium` Welcome-sized overlay is shown. */
  private aquariumOverlaySnapshot: Component[] | undefined;
  /**
   * When true, {@link addChild} does not auto-dismiss the aquarium/region
   * overlay — used by Conductor Timeline so chat keeps accumulating under
   * the overlay until the operator switches back.
   */
  private regionOverlayLocked = false;
  /**
   * When true, {@link addChild} skips per-child {@link invalidate}. Session
   * hydrate mounts hundreds of steps; invalidating on every add forces
   * O(n²) line-count remeasure. Callers must {@link endBatchMount} (or
   * invalidate once) when the batch finishes.
   */
  private batchMountDepth = 0;
  /** O(1) idle aquarium presence — avoids children.some every ambient frame. */
  private idleStageMounted = false;

  constructor(
    leftPad: number,
    rightPad: number,
    viewport: TranscriptViewportState,
    getVisibleRows: (width: number) => number,
  ) {
    super({
      viewport,
      getVisibleRows,
      leftPad,
      rightPad,
      scrollbarTrackChar: TRANSCRIPT_SCROLLBAR_TRACK,
      scrollbarThumbChar: TRANSCRIPT_SCROLLBAR_THUMB,
      scrollbarVariant: 'capsule',
      paintScrollbarGlyph: paintTranscriptScrollbarGlyph,
      paintLine: paintCanvasLine,
      isCacheEnabled: isRenderCacheEnabled,
      getCacheEpoch: renderCacheEpoch,
    });
    this.resolveVisibleRows = getVisibleRows;
  }

  /** Transcript region row budget for the current terminal chrome. */
  transcriptRows(width: number): number {
    return this.resolveVisibleRows(width);
  }

  /**
   * Rows the idle night sky should paint: full transcript budget minus
   * non-idle chrome siblings (Welcome / Banner). Prevents Welcome+Idle from
   * overflowing the viewport and leaving a scrollbar on an empty session.
   */
  idleTargetRows(width: number): number {
    const budget = Math.max(0, Math.trunc(this.resolveVisibleRows(width)));
    if (budget === 0) return 0;
    // Probe-only: do not run live tool ticks while sizing the idle scene.
    return withTranscriptMeasureMode(() => {
      let other = 0;
      for (const child of this.children) {
        if (child instanceof IdleStageComponent) continue;
        other += child.render(width).length;
      }
      // Keep a usable multi-layer scene even when Welcome is tall.
      return Math.max(10, budget - other);
    });
  }

  get isAquariumOverlayActive(): boolean {
    return this.aquariumOverlaySnapshot !== undefined;
  }

  /** True when an IdleStage child is mounted (Jewel Tank / night sky). */
  get hasIdleStageMounted(): boolean {
    return this.idleStageMounted;
  }

  /**
   * Hide current transcript content and mount Welcome-sized chrome (caller
   * supplies Welcome + IdleStage). Restored when a real message is added.
   */
  showAquariumOverlay(mountChrome: (addChrome: (component: Component) => void) => void): void {
    this.aquariumOverlaySnapshot ??= [...this.children];
    // Snapshot the children: removeChild mutates this.children mid-iteration.
    for (const child of this.children.slice()) {
      // pi-tui Container.removeChild (not a DOM node).
      // oxlint-disable-next-line unicorn/prefer-dom-node-remove
      this.removeChild(child);
    }
    mountChrome((component) => {
      super.addChild(component);
    });
    this.invalidate();
  }

  /**
   * Conductor Timeline (and similar): lock the overlay so streaming transcript
   * children accumulate into the hidden snapshot instead of dismissing it.
   */
  showLockedRegionOverlay(mountChrome: (addChrome: (component: Component) => void) => void): void {
    this.regionOverlayLocked = true;
    this.showAquariumOverlay(mountChrome);
  }

  /** Restore transcript children hid by {@link showAquariumOverlay}. */
  exitAquariumOverlay(): void {
    this.regionOverlayLocked = false;
    const snapshot = this.aquariumOverlaySnapshot;
    if (snapshot === undefined) {
      this.dismissIdleStage();
      return;
    }
    // Snapshot the children: removeChild mutates this.children mid-iteration.
    for (const child of this.children.slice()) {
      // oxlint-disable-next-line unicorn/prefer-dom-node-remove
      this.removeChild(child);
    }
    this.aquariumOverlaySnapshot = undefined;
    for (const child of snapshot) {
      // Drop stale idle stages from the pre-overlay tree.
      if (child instanceof IdleStageComponent) continue;
      super.addChild(child);
    }
    this.invalidate();
  }

  /** Begin bulk child mounts (session hydrate). Nested calls are reference-counted. */
  beginBatchMount(): void {
    this.batchMountDepth += 1;
  }

  /**
   * End bulk mounts and invalidate once so line-count / render caches rebuild
   * after the full tree is in place.
   */
  endBatchMount(): void {
    if (this.batchMountDepth <= 0) return;
    this.batchMountDepth -= 1;
    if (this.batchMountDepth === 0) {
      this.invalidate();
    }
  }

  get isBatchMounting(): boolean {
    return this.batchMountDepth > 0;
  }

  override addChild(component: Component): void {
    // Real transcript content dismisses the empty-state ambient stage so the
    // scene never competes with user/assistant/tool output.
    if (!isEmptyTranscriptChrome(component)) {
      if (this.aquariumOverlaySnapshot !== undefined) {
        if (this.regionOverlayLocked) {
          // Accumulate under the locked overlay (Timeline) without dismissing.
          this.aquariumOverlaySnapshot.push(component);
          if (this.batchMountDepth === 0) {
            this.invalidatePaint();
          }
          return;
        }
        this.exitAquariumOverlay();
      } else {
        this.dismissIdleStage();
      }
    }
    if (component instanceof IdleStageComponent) {
      this.idleStageMounted = true;
    }
    super.addChild(component);
    // Hydrate mounts many children in one sync pass; defer invalidate so we
    // do not re-render every previous child on each add (O(n²) storm).
    //
    // Outside batch mount: drop paint caches only. Geometry (per-child line
    // counts) reconciles by Component identity on the next resolve — append
    // remeasures the new slot only. Cascading invalidate() to every prior
    // sibling would clear their render caches and force a full remeasure
    // storm on every streaming message.
    if (this.batchMountDepth === 0) {
      this.invalidatePaint();
    }
  }

  override removeChild(component: Component): void {
    super.removeChild(component);
    if (component instanceof IdleStageComponent) {
      this.idleStageMounted = this.children.some(
        (child) => child instanceof IdleStageComponent,
      );
    }
  }

  override clear(): void {
    super.clear();
    this.idleStageMounted = false;
  }

  /** Drop every IdleStage child (idempotent). */
  dismissIdleStage(): void {
    const idle = this.children.filter((child) => child instanceof IdleStageComponent);
    for (const child of idle) {
      // pi-tui Container.removeChild (not a DOM node).
      // oxlint-disable-next-line unicorn/prefer-dom-node-remove
      this.removeChild(child);
    }
    this.idleStageMounted = false;
  }
}

function paintCanvasLine(line: string, width: number): string {
  if (!currentTheme.canvasBackgroundEnabled || width <= 0) return line;
  const padding = Math.max(0, width - visibleWidth(line));
  return currentTheme.bg('background', line + ' '.repeat(padding));
}

/**
 * Theme-aware scrollbar paint: thumb glows with primary/glow, track stays
 * muted, edge cues use particle so the gutter feels alive without noise.
 */
function paintTranscriptScrollbarGlyph(
  role: RendererScrollbarGlyphRole,
  glyph: string,
): string {
  switch (role) {
    case 'thumb':
    case 'thumb-mid':
    case 'thumb-only':
      return currentTheme.boldFg('primary', glyph);
    case 'thumb-top':
    case 'thumb-bottom':
      return currentTheme.fg('glow', glyph);
    case 'cap-top':
    case 'cap-bottom':
      return currentTheme.fg('particle', glyph);
    case 'track':
    default:
      return currentTheme.dimFg('textMuted', glyph);
  }
}
