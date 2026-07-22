/**
 * ResponsiveLayoutEngine — fluid adaptive layout for all terminal sizes.
 *
 * Provides a constraint-based layout system that automatically adapts to
 * terminal dimensions (small: <80col, medium: 80-140col, large: >140col).
 *
 * Features:
 * - Breakpoint system (compact/standard/wide/ultrawide)
 * - Flexbox-inspired proportional sizing with min/max constraints
 * - Panel priority for graceful degradation on narrow screens
 * - Orientation-aware (landscape vs portrait terminals)
 * - Safe area insets (status bars, multiplexer chrome)
 * - Layout caching with invalidation on resize
 * - Animation support for layout transitions
 *
 * Inspired by: CSS Grid/Flexbox, Flutter Layout, ink (React for CLIs)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Breakpoint = 'compact' | 'standard' | 'wide' | 'ultrawide';

export type LayoutDirection = 'horizontal' | 'vertical';

export type PanelPriority = 'required' | 'high' | 'medium' | 'low';

export interface SizeConstraint {
  readonly min: number;
  readonly max: number;
  /** Flex grow factor (0 = fixed). */
  readonly flex: number;
  /** Preferred size (used when flex distributes space). */
  readonly preferred?: number;
}

export interface LayoutRegion {
  readonly id: string;
  readonly priority: PanelPriority;
  readonly constraint: SizeConstraint;
  /** Whether this region can be collapsed to a tab/icon. */
  readonly collapsible: boolean;
  /** Minimum breakpoint at which this region is visible. */
  readonly minBreakpoint: Breakpoint;
}

export interface ResolvedRegion {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly collapsed: boolean;
}

export interface LayoutConfig {
  readonly direction: LayoutDirection;
  readonly regions: readonly LayoutRegion[];
  /** Gap between regions (in cells). */
  readonly gap: number;
  /** Padding around the entire layout. */
  readonly padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
}

export interface LayoutTransition {
  readonly from: readonly ResolvedRegion[];
  readonly to: readonly ResolvedRegion[];
  readonly startTime: number;
  readonly duration: number;
}

export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BREAKPOINT_THRESHOLDS: Record<Breakpoint, number> = {
  compact: 0,
  standard: 80,
  wide: 140,
  ultrawide: 200,
};

const BREAKPOINT_ORDER: Breakpoint[] = ['compact', 'standard', 'wide', 'ultrawide'];

const PRIORITY_WEIGHT: Record<PanelPriority, number> = {
  required: 1000,
  high: 100,
  medium: 10,
  low: 1,
};

/** Default layout transition duration (ms). */
const TRANSITION_DURATION = 200;

// ---------------------------------------------------------------------------
// ResponsiveLayoutEngine
// ---------------------------------------------------------------------------

export class ResponsiveLayoutEngine {
  private config: LayoutConfig;
  private columns: number;
  private rows: number;
  private safeArea: SafeAreaInsets;
  private cachedResult: ResolvedRegion[] | null = null;
  private transition: LayoutTransition | null = null;

  constructor(config: LayoutConfig, columns: number = 80, rows: number = 24) {
    this.config = config;
    this.columns = columns;
    this.rows = rows;
    this.safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  }

  // ─── Configuration ────────────────────────────────────────────────

  /** Update terminal dimensions (triggers re-layout). */
  resize(columns: number, rows: number): void {
    if (columns !== this.columns || rows !== this.rows) {
      const oldResult = this.cachedResult;
      this.columns = columns;
      this.rows = rows;
      this.cachedResult = null;

      // Start transition animation if we have a previous layout
      if (oldResult) {
        const newResult = this.resolve();
        this.transition = {
          from: oldResult,
          to: newResult,
          startTime: Date.now(),
          duration: TRANSITION_DURATION,
        };
      }
    }
  }

  /** Set safe area insets (multiplexer chrome, status bars). */
  setSafeArea(insets: SafeAreaInsets): void {
    this.safeArea = insets;
    this.cachedResult = null;
  }

  /** Update the layout configuration. */
  setConfig(config: LayoutConfig): void {
    this.config = config;
    this.cachedResult = null;
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /** Get the current breakpoint based on available width. */
  getBreakpoint(): Breakpoint {
    const availWidth = this.availableWidth();
    if (availWidth >= BREAKPOINT_THRESHOLDS.ultrawide) return 'ultrawide';
    if (availWidth >= BREAKPOINT_THRESHOLDS.wide) return 'wide';
    if (availWidth >= BREAKPOINT_THRESHOLDS.standard) return 'standard';
    return 'compact';
  }

  /** Whether the terminal is in portrait orientation (taller than wide). */
  isPortrait(): boolean {
    return this.rows > this.columns;
  }

  /** Available width after safe area deduction. */
  availableWidth(): number {
    return Math.max(20, this.columns - this.safeArea.left - this.safeArea.right);
  }

  /** Available height after safe area deduction. */
  availableHeight(): number {
    return Math.max(5, this.rows - this.safeArea.top - this.safeArea.bottom);
  }

  // ─── Layout Resolution ────────────────────────────────────────────

  /** Resolve the layout into concrete region positions. */
  resolve(): ResolvedRegion[] {
    if (this.cachedResult) return this.cachedResult;

    const breakpoint = this.getBreakpoint();
    const availW = this.availableWidth();
    const availH = this.availableHeight();
    const offsetX = this.safeArea.left;
    const offsetY = this.safeArea.top;

    // Filter regions visible at current breakpoint
    const visibleRegions = this.config.regions.filter(
      (r) => breakpointAtLeast(breakpoint, r.minBreakpoint),
    );

    // Sort by priority (required first)
    const sorted = [...visibleRegions].sort(
      (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority],
    );

    const isHorizontal = this.config.direction === 'horizontal';
    const totalSpace = isHorizontal ? availW : availH;
    const crossSpace = isHorizontal ? availH : availW;
    const gap = this.config.gap;
    const totalGaps = Math.max(0, sorted.length - 1) * gap;
    const distributableSpace = totalSpace - totalGaps;

    // Phase 1: Allocate fixed-size and minimum constraints
    const allocations = new Map<string, number>();
    let remainingSpace = distributableSpace;
    let totalFlex = 0;

    for (const region of sorted) {
      const { min, max, flex, preferred } = region.constraint;
      if (flex === 0) {
        // Fixed size
        const size = Math.min(max, Math.max(min, preferred ?? min));
        allocations.set(region.id, size);
        remainingSpace -= size;
      } else {
        // Flexible: allocate minimum first
        allocations.set(region.id, min);
        remainingSpace -= min;
        totalFlex += flex;
      }
    }

    // Phase 2: Distribute remaining space proportionally by flex
    if (totalFlex > 0 && remainingSpace > 0) {
      for (const region of sorted) {
        const { flex, max } = region.constraint;
        if (flex > 0) {
          const current = allocations.get(region.id) ?? 0;
          const extra = Math.min(
            (remainingSpace * flex) / totalFlex,
            max - current,
          );
          allocations.set(region.id, current + Math.max(0, extra));
        }
      }
    }

    // Phase 3: Collapse low-priority regions if space is negative
    if (remainingSpace < 0) {
      const collapsible = sorted
        .filter((r) => r.collapsible && r.priority !== 'required')
        .sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]);

      for (const region of collapsible) {
        if (remainingSpace >= 0) break;
        const freed = allocations.get(region.id) ?? 0;
        allocations.set(region.id, 0);
        remainingSpace += freed + gap;
      }
    }

    // Phase 4: Build resolved regions with positions
    const result: ResolvedRegion[] = [];
    let cursor = 0;

    for (const region of sorted) {
      const size = Math.max(0, allocations.get(region.id) ?? 0);
      const visible = size > 0;
      const collapsed = size === 0 && region.collapsible;

      const resolved: ResolvedRegion = isHorizontal
        ? {
            id: region.id,
            x: offsetX + cursor,
            y: offsetY,
            width: size,
            height: crossSpace,
            visible,
            collapsed,
          }
        : {
            id: region.id,
            x: offsetX,
            y: offsetY + cursor,
            width: crossSpace,
            height: size,
            visible,
            collapsed,
          };

      result.push(resolved);
      if (visible) {
        cursor += size + gap;
      }
    }

    this.cachedResult = result;
    return result;
  }

  /** Get a specific region's resolved layout. */
  getRegion(id: string): ResolvedRegion | null {
    return this.resolve().find((r) => r.id === id) ?? null;
  }

  // ─── Transition Animation ─────────────────────────────────────────

  /** Get interpolated layout during a transition. */
  getAnimatedLayout(now: number = Date.now()): ResolvedRegion[] | null {
    if (!this.transition) return null;

    const { from, to, startTime, duration } = this.transition;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);

    if (t >= 1) {
      this.transition = null;
      return null; // Transition complete, use static layout
    }

    // Ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);

    return to.map((toRegion) => {
      const fromRegion = from.find((r) => r.id === toRegion.id);
      if (!fromRegion) return toRegion;

      return {
        id: toRegion.id,
        x: Math.round(lerp(fromRegion.x, toRegion.x, eased)),
        y: Math.round(lerp(fromRegion.y, toRegion.y, eased)),
        width: Math.round(lerp(fromRegion.width, toRegion.width, eased)),
        height: Math.round(lerp(fromRegion.height, toRegion.height, eased)),
        visible: toRegion.visible,
        collapsed: toRegion.collapsed,
      };
    });
  }

  /** Whether a layout transition is in progress. */
  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  // ─── Preset Layouts ───────────────────────────────────────────────

  /** Create a standard TUI layout (sidebar + main + optional right panel). */
  static createStandardLayout(): LayoutConfig {
    return {
      direction: 'horizontal',
      gap: 1,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      regions: [
        {
          id: 'sidebar',
          priority: 'medium',
          constraint: { min: 20, max: 35, flex: 0, preferred: 25 },
          collapsible: true,
          minBreakpoint: 'standard',
        },
        {
          id: 'main',
          priority: 'required',
          constraint: { min: 40, max: Infinity, flex: 3 },
          collapsible: false,
          minBreakpoint: 'compact',
        },
        {
          id: 'detail',
          priority: 'low',
          constraint: { min: 25, max: 50, flex: 1 },
          collapsible: true,
          minBreakpoint: 'wide',
        },
      ],
    };
  }

  /** Create a split-pane layout (two equal panels). */
  static createSplitLayout(): LayoutConfig {
    return {
      direction: 'horizontal',
      gap: 1,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      regions: [
        {
          id: 'left',
          priority: 'required',
          constraint: { min: 30, max: Infinity, flex: 1 },
          collapsible: false,
          minBreakpoint: 'compact',
        },
        {
          id: 'right',
          priority: 'high',
          constraint: { min: 30, max: Infinity, flex: 1 },
          collapsible: true,
          minBreakpoint: 'standard',
        },
      ],
    };
  }

  /** Create a stacked layout (header + content + footer). */
  static createStackedLayout(): LayoutConfig {
    return {
      direction: 'vertical',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      regions: [
        {
          id: 'header',
          priority: 'high',
          constraint: { min: 1, max: 3, flex: 0, preferred: 1 },
          collapsible: false,
          minBreakpoint: 'compact',
        },
        {
          id: 'content',
          priority: 'required',
          constraint: { min: 5, max: Infinity, flex: 1 },
          collapsible: false,
          minBreakpoint: 'compact',
        },
        {
          id: 'footer',
          priority: 'high',
          constraint: { min: 1, max: 2, flex: 0, preferred: 1 },
          collapsible: false,
          minBreakpoint: 'compact',
        },
      ],
    };
  }

  /** Create a swarm monitoring layout (grid of agent cards). */
  static createSwarmLayout(agentCount: number): LayoutConfig {
    const cols = agentCount <= 2 ? 1 : agentCount <= 6 ? 2 : 3;
    const regions: LayoutRegion[] = [];

    for (let i = 0; i < Math.min(agentCount, 9); i++) {
      regions.push({
        id: `agent-${String(i)}`,
        priority: i === 0 ? 'required' : 'medium',
        constraint: { min: 20, max: Infinity, flex: 1 },
        collapsible: i > 3,
        minBreakpoint: i < cols ? 'compact' : i < cols * 2 ? 'standard' : 'wide',
      });
    }

    return {
      direction: 'horizontal',
      gap: 1,
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      regions,
    };
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function breakpointAtLeast(current: Breakpoint, minimum: Breakpoint): boolean {
  return BREAKPOINT_ORDER.indexOf(current) >= BREAKPOINT_ORDER.indexOf(minimum);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute safe area insets based on detected environment.
 */
export function computeSafeArea(
  multiplexer: 'tmux' | 'zellij' | 'screen' | null,
  hasStatusBar: boolean = true,
): SafeAreaInsets {
  let top = 0;
  let bottom = 0;

  switch (multiplexer) {
    case 'tmux':
      bottom += 1; // status bar
      break;
    case 'zellij':
      top += 1; // tab bar
      bottom += 1; // status bar
      break;
    case 'screen':
      bottom += 1; // hardstatus
      break;
  }

  if (hasStatusBar) {
    bottom += 1; // TUI's own status bar
  }

  return { top, right: 0, bottom, left: 0 };
}

/**
 * Get a human-readable description of the current layout state.
 */
export function describeLayout(engine: ResponsiveLayoutEngine): string {
  const bp = engine.getBreakpoint();
  const regions = engine.resolve();
  const visible = regions.filter((r) => r.visible);
  const collapsed = regions.filter((r) => r.collapsed);

  const parts: string[] = [`${bp} (${String(engine.availableWidth())}×${String(engine.availableHeight())})`];
  parts.push(`${String(visible.length)} visible`);
  if (collapsed.length > 0) parts.push(`${String(collapsed.length)} collapsed`);
  return parts.join(', ');
}
