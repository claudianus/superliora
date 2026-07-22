/**
 * BreadcrumbNavigation — visual context path with quick navigation.
 *
 * Provides a file-explorer-style breadcrumb trail showing the user's
 * current position in the TUI's navigation hierarchy:
 * - Session > Panel > File/Agent > Detail
 * - Clickable segments (mouse) or keyboard shortcuts for quick jumps
 * - Overflow handling (collapses middle segments on narrow widths)
 * - Animated transitions when path changes
 * - Context-aware icons per segment type
 *
 * Segment types:
 * - session: The active session/conversation
 * - panel: A workspace panel (transcript, files, git, agents)
 * - item: A specific item within a panel (file, branch, agent)
 * - detail: A sub-view of an item (diff, log, config)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreadcrumbSegmentType = 'session' | 'panel' | 'item' | 'detail' | 'action';

export interface BreadcrumbSegment {
  readonly id: string;
  readonly label: string;
  readonly type: BreadcrumbSegmentType;
  readonly icon?: string;
  /** Whether this segment is clickable/navigable. */
  readonly navigable: boolean;
  /** Optional badge (e.g. unread count, error count). */
  readonly badge?: string;
}

export interface BreadcrumbRenderOptions {
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  /** Index of the hovered segment (-1 = none). */
  readonly hoverIndex?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEGMENT_ICON: Record<BreadcrumbSegmentType, string> = {
  session: '💬',
  panel: '◫',
  item: '📄',
  detail: '🔍',
  action: '⚡',
};

const SEPARATOR = ' › ';
const COLLAPSED_LABEL = '…';
const MIN_SEGMENT_WIDTH = 4;

// ---------------------------------------------------------------------------
// BreadcrumbNavigation
// ---------------------------------------------------------------------------

export class BreadcrumbNavigation {
  private segments: BreadcrumbSegment[] = [];
  private hoverIndex = -1;

  // ─── Path Management ──────────────────────────────────────────────

  /** Set the full breadcrumb path. */
  setPath(segments: BreadcrumbSegment[]): void {
    this.segments = segments;
  }

  /** Push a segment onto the path (navigate deeper). */
  push(segment: BreadcrumbSegment): void {
    this.segments.push(segment);
  }

  /** Pop the last segment (navigate up). */
  pop(): BreadcrumbSegment | undefined {
    return this.segments.pop();
  }

  /** Navigate to a specific depth (0-based). */
  navigateTo(depth: number): void {
    if (depth >= 0 && depth < this.segments.length) {
      this.segments = this.segments.slice(0, depth + 1);
    }
  }

  /** Clear the path. */
  clear(): void {
    this.segments = [];
  }

  /** Get the current path. */
  getPath(): readonly BreadcrumbSegment[] {
    return this.segments;
  }

  /** Get the current (deepest) segment. */
  getCurrent(): BreadcrumbSegment | null {
    return this.segments[this.segments.length - 1] ?? null;
  }

  /** Get the depth. */
  get depth(): number {
    return this.segments.length;
  }

  // ─── Hover / Interaction ──────────────────────────────────────────

  setHover(index: number): void {
    this.hoverIndex = index;
  }

  clearHover(): void {
    this.hoverIndex = -1;
  }

  /** Get the segment at a given character position (for mouse clicks). */
  hitTest(charX: number, renderedWidth: number): number {
    // Simplified: divide width evenly among visible segments
    if (this.segments.length === 0) return -1;
    const segWidth = renderedWidth / this.segments.length;
    const idx = Math.floor(charX / segWidth);
    return Math.min(idx, this.segments.length - 1);
  }

  // ─── Rendering ────────────────────────────────────────────────────

  render(options: BreadcrumbRenderOptions): string {
    const { width, fg, boldFg, dimFg, hoverIndex = this.hoverIndex } = options;

    if (this.segments.length === 0) {
      return dimFg('textMuted', ' (no path)');
    }

    // Calculate available width for segments
    const separatorWidth = SEPARATOR.length;
    const totalSeparators = (this.segments.length - 1) * separatorWidth;
    const availableForSegments = width - totalSeparators - 2; // 2 for padding

    // Determine which segments to show (collapse middle if too narrow)
    const visibleSegments = this.fitSegments(availableForSegments);

    // Render each segment
    const parts: string[] = [];
    for (let i = 0; i < visibleSegments.length; i++) {
      const seg = visibleSegments[i]!;
      const isLast = i === visibleSegments.length - 1;
      const isHovered = i === hoverIndex;

      if (seg.label === COLLAPSED_LABEL) {
        parts.push(dimFg('textMuted', COLLAPSED_LABEL));
      } else {
        parts.push(this.renderSegment(seg, isLast, isHovered, fg, boldFg, dimFg));
      }

      // Separator (except after last)
      if (i < visibleSegments.length - 1) {
        parts.push(dimFg('textMuted', SEPARATOR));
      }
    }

    return ` ${parts.join('')}`;
  }

  private renderSegment(
    seg: BreadcrumbSegment,
    isLast: boolean,
    isHovered: boolean,
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
  ): string {
    const icon = seg.icon ?? SEGMENT_ICON[seg.type];
    const badge = seg.badge ? fg('error', ` ${seg.badge}`) : '';

    if (isLast) {
      // Current segment: bold + accented
      return `${boldFg('accent', icon)} ${boldFg('text', seg.label)}${badge}`;
    }

    if (isHovered && seg.navigable) {
      // Hovered: underlined effect (use accent)
      return `${fg('accent', icon)} ${fg('accent', seg.label)}${badge}`;
    }

    // Normal ancestor: dimmed
    return `${dimFg('textMuted', icon)} ${dimFg('textMuted', seg.label)}${badge}`;
  }

  /**
   * Fit segments into available width, collapsing middle segments if needed.
   * Always keeps first and last segments visible.
   */
  private fitSegments(availableWidth: number): BreadcrumbSegment[] {
    if (this.segments.length === 0) return [];

    // Calculate natural width of each segment
    const widths = this.segments.map((s) => {
      const icon = s.icon ?? SEGMENT_ICON[s.type];
      return icon.length + 1 + s.label.length + (s.badge ? s.badge.length + 1 : 0);
    });

    const totalWidth = widths.reduce((a, b) => a + b, 0);

    // If everything fits, show all
    if (totalWidth <= availableWidth) {
      return this.segments;
    }

    // Strategy: keep first + last, collapse middle
    if (this.segments.length <= 2) {
      // Can't collapse further, truncate labels
      return this.segments.map((s, i) => {
        const maxLabel = Math.max(MIN_SEGMENT_WIDTH, Math.floor(availableWidth / this.segments.length) - 3);
        return { ...s, label: truncateLabel(s.label, maxLabel) };
      });
    }

    // Keep first, last, and as many middle as fit
    const first = this.segments[0]!;
    const last = this.segments[this.segments.length - 1]!;
    const firstWidth = widths[0] ?? 5;
    const lastWidth = widths[widths.length - 1] ?? 5;
    const collapsedWidth = 1; // "…"
    let budget = availableWidth - firstWidth - lastWidth - collapsedWidth;

    // Try to fit middle segments from right to left (most relevant first)
    const middleSegments: BreadcrumbSegment[] = [];
    for (let i = this.segments.length - 2; i >= 1; i--) {
      const w = widths[i] ?? 5;
      if (w <= budget) {
        middleSegments.unshift(this.segments[i]!);
        budget -= w;
      } else {
        break;
      }
    }

    if (middleSegments.length === this.segments.length - 2) {
      // All middle segments fit
      return this.segments;
    }

    // Build collapsed path: first … [visible middle] last
    const collapsed: BreadcrumbSegment = {
      id: '__collapsed__',
      label: COLLAPSED_LABEL,
      type: 'action',
      navigable: false,
    };

    return [first, collapsed, ...middleSegments, last];
  }
}

// ---------------------------------------------------------------------------
// Preset Paths
// ---------------------------------------------------------------------------

/** Create a breadcrumb path for the transcript view. */
export function transcriptPath(sessionName: string): BreadcrumbSegment[] {
  return [
    { id: 'session', label: sessionName, type: 'session', navigable: true },
    { id: 'transcript', label: 'Transcript', type: 'panel', icon: '📜', navigable: true },
  ];
}

/** Create a breadcrumb path for a file in the explorer. */
export function filePath(sessionName: string, filePath: string): BreadcrumbSegment[] {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1] ?? filePath;

  return [
    { id: 'session', label: sessionName, type: 'session', navigable: true },
    { id: 'files', label: 'Files', type: 'panel', icon: '📁', navigable: true },
    { id: 'file', label: fileName, type: 'item', icon: '📄', navigable: false },
  ];
}

/** Create a breadcrumb path for an agent in the swarm. */
export function agentPath(sessionName: string, agentName: string, detail?: string): BreadcrumbSegment[] {
  const path: BreadcrumbSegment[] = [
    { id: 'session', label: sessionName, type: 'session', navigable: true },
    { id: 'agents', label: 'Agents', type: 'panel', icon: '🤖', navigable: true },
    { id: 'agent', label: agentName, type: 'item', icon: '⚙', navigable: true },
  ];

  if (detail) {
    path.push({ id: 'detail', label: detail, type: 'detail', navigable: false });
  }

  return path;
}

/** Create a breadcrumb path for the git panel. */
export function gitPath(sessionName: string, branch: string, view?: string): BreadcrumbSegment[] {
  const path: BreadcrumbSegment[] = [
    { id: 'session', label: sessionName, type: 'session', navigable: true },
    { id: 'git', label: 'Git', type: 'panel', icon: '🌿', navigable: true },
    { id: 'branch', label: branch, type: 'item', icon: '🔀', navigable: true },
  ];

  if (view) {
    path.push({ id: 'view', label: view, type: 'detail', navigable: false });
  }

  return path;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function truncateLabel(label: string, max: number): string {
  if (label.length <= max) return label;
  if (max <= 2) return label.slice(0, max);
  return label.slice(0, max - 1) + '…';
}
