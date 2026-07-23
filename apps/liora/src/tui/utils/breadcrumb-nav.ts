/**
 * BreadcrumbNav — hierarchical path navigation breadcrumbs.
 *
 * Provides GUI-quality breadcrumb navigation:
 * - File path breadcrumbs (src / components / Button.tsx)
 * - Hierarchy navigation (Project > Module > Class > Method)
 * - Clickable segments (jump to any level)
 * - Overflow handling (collapse middle segments with …)
 * - Icon per segment type
 * - Current segment highlighting
 * - Keyboard navigation (Left/Right to move, Enter to select)
 * - Dropdown on overflow (show all collapsed segments)
 * - Custom separators (/, >, ›, →)
 * - Truncation for long segment names
 * - Git branch indicator integration
 *
 * Visual styles:
 * - Classic:  src / components / Button.tsx
 * - Arrows:   src › components › Button.tsx
 * - Chevrons: src ❯ components ❯ Button.tsx
 * - Dots:     src · components · Button.tsx
 * - Pills:    [src] [components] [Button.tsx]
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadcrumbSegment {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly type?: 'folder' | 'file' | 'class' | 'method' | 'module' | 'branch' | 'custom';
  readonly truncated?: string; // Full label if truncated
  readonly action?: () => void;
}

export type BreadcrumbStyle = 'classic' | 'arrows' | 'chevrons' | 'dots' | 'pills';

export interface BreadcrumbRenderOptions {
  readonly width: number;
  readonly style?: BreadcrumbStyle;
  readonly maxSegments?: number; // Max visible before collapsing
  readonly maxLabelLength?: number; // Truncate labels longer than this
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEPARATORS: Record<BreadcrumbStyle, string> = {
  classic: ' / ',
  arrows: ' › ',
  chevrons: ' ❯ ',
  dots: ' · ',
  pills: ' ',
};

const TYPE_ICONS: Record<string, string> = {
  folder: '📁',
  file: '📄',
  class: '🔷',
  method: 'ƒ',
  module: '📦',
  branch: '🌿',
  custom: '•',
};

const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// BreadcrumbNav
// ---------------------------------------------------------------------------

export class BreadcrumbNav {
  private segments: BreadcrumbSegment[] = [];
  private cursorIndex = -1; // -1 = last (current)
  private overflowOpen = false;

  // ─── Segment Management ──────────────────────────────────────────

  /** Set the full breadcrumb path. */
  setPath(segments: BreadcrumbSegment[]): void {
    this.segments = segments;
    this.cursorIndex = segments.length > 0 ? segments.length - 1 : -1;
  }

  /** Set path from a file path string. */
  setFilePath(path: string): void {
    const parts = path.split('/').filter((p) => p.length > 0);
    this.segments = parts.map((part, i) => ({
      id: `seg-${String(i)}`,
      label: part,
      type: i === parts.length - 1 ? 'file' : 'folder',
    }));
    this.cursorIndex = this.segments.length - 1;
  }

  /** Push a new segment. */
  push(segment: BreadcrumbSegment): void {
    this.segments.push(segment);
    this.cursorIndex = this.segments.length - 1;
  }

  /** Pop the last segment. */
  pop(): BreadcrumbSegment | undefined {
    const removed = this.segments.pop();
    this.cursorIndex = this.segments.length - 1;
    return removed;
  }

  /** Navigate to a specific segment index. */
  navigateTo(index: number): void {
    if (index >= 0 && index < this.segments.length) {
      // Remove all segments after the target
      this.segments = this.segments.slice(0, index + 1);
      this.cursorIndex = index;
      const segment = this.segments[index];
      if (segment?.action) segment.action();
    }
  }

  /** Clear all segments. */
  clear(): void {
    this.segments = [];
    this.cursorIndex = -1;
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Move cursor left (parent). */
  moveLeft(): void {
    if (this.cursorIndex > 0) {
      this.cursorIndex--;
    }
  }

  /** Move cursor right (child). */
  moveRight(): void {
    if (this.cursorIndex < this.segments.length - 1) {
      this.cursorIndex++;
    }
  }

  /** Select the current cursor segment. */
  select(): void {
    if (this.cursorIndex >= 0 && this.cursorIndex < this.segments.length) {
      this.navigateTo(this.cursorIndex);
    }
  }

  /** Toggle overflow dropdown. */
  toggleOverflow(): void {
    this.overflowOpen = !this.overflowOpen;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all segments. */
  getSegments(): readonly BreadcrumbSegment[] {
    return this.segments;
  }

  /** Get current (last) segment. */
  getCurrent(): BreadcrumbSegment | null {
    return this.segments[this.segments.length - 1] ?? null;
  }

  /** Get segment count. */
  get count(): number {
    return this.segments.length;
  }

  /** Get cursor index. */
  get cursor(): number {
    return this.cursorIndex;
  }

  /** Get the current path as string. */
  getPathString(separator = '/'): string {
    return this.segments.map((s) => s.label).join(separator);
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the breadcrumb trail. */
  render(options: BreadcrumbRenderOptions): string {
    const { width, style = 'classic', maxSegments = 5, maxLabelLength = 20, fg, boldFg, dimFg } = options;

    if (this.segments.length === 0) {
      return dimFg('textDim', '(empty)');
    }

    const separator = SEPARATORS[style];
    const isPills = style === 'pills';

    // Determine which segments to show
    let visibleSegments: { segment: BreadcrumbSegment; index: number; collapsed: boolean }[];

    if (this.segments.length <= maxSegments) {
      visibleSegments = this.segments.map((s, i) => ({ segment: s, index: i, collapsed: false }));
    } else {
      // Show first, ellipsis, last (maxSegments - 2)
      const firstCount = 1;
      const lastCount = maxSegments - 2;
      const first = this.segments.slice(0, firstCount).map((s, i) => ({ segment: s, index: i, collapsed: false }));
      const last = this.segments.slice(-lastCount).map((s, i) => ({
        segment: s,
        index: this.segments.length - lastCount + i,
        collapsed: false,
      }));

      visibleSegments = [
        ...first,
        { segment: { id: 'ellipsis', label: ELLIPSIS }, index: -1, collapsed: true },
        ...last,
      ];
    }

    // Render each segment
    const parts: string[] = [];

    for (let i = 0; i < visibleSegments.length; i++) {
      const { segment, index, collapsed } = visibleSegments[i]!;

      if (collapsed) {
        parts.push(dimFg('textMuted', ELLIPSIS));
        continue;
      }

      const isCurrent = index === this.segments.length - 1;
      const isCursor = index === this.cursorIndex;

      // Icon
      const icon = segment.icon ?? (segment.type ? TYPE_ICONS[segment.type] : undefined);
      const iconStr = icon ? `${icon} ` : '';

      // Label (truncate if needed)
      let label = segment.label;
      if (label.length > maxLabelLength) {
        label = label.slice(0, maxLabelLength - 1) + ELLIPSIS;
      }

      // Style based on state
      let rendered: string;
      if (isPills) {
        // Pill style: [label]
        if (isCurrent) {
          rendered = fg('primary', `[${iconStr}${label}]`);
        } else if (isCursor) {
          rendered = boldFg('text', `[${iconStr}${label}]`);
        } else {
          rendered = dimFg('textMuted', `[${iconStr}${label}]`);
        }
      } else {
        if (isCurrent) {
          rendered = boldFg('text', `${iconStr}${label}`);
        } else if (isCursor) {
          rendered = fg('primary', `${iconStr}${label}`);
        } else {
          rendered = dimFg('textMuted', `${iconStr}${label}`);
        }
      }

      parts.push(rendered);
    }

    // Join with separator
    let result = parts.join(isPills ? ' ' : dimFg('textDim', separator.trim()));

    // Truncate if too long
    const plainLen = result.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (plainLen > width) {
      // Try with fewer segments
      return this.render({ ...options, maxSegments: Math.max(2, maxSegments - 1) });
    }

    return result;
  }

  /** Render with dropdown for collapsed segments. */
  renderWithDropdown(options: BreadcrumbRenderOptions): string[] {
    const lines: string[] = [];
    const { fg, dimFg } = options;

    // Main breadcrumb line
    lines.push(this.render(options));

    // Dropdown (if overflow is open)
    if (this.overflowOpen && this.segments.length > (options.maxSegments ?? 5)) {
      lines.push(dimFg('textMuted', '  ┌─────────────────┐'));
      const hiddenStart = 1;
      const hiddenEnd = this.segments.length - ((options.maxSegments ?? 5) - 2);
      for (let i = hiddenStart; i < hiddenEnd; i++) {
        const seg = this.segments[i]!;
        const icon = seg.icon ?? (seg.type ? TYPE_ICONS[seg.type] : '');
        lines.push(`  │ ${fg('text', `${icon} ${seg.label}`)}${' '.repeat(Math.max(0, 15 - seg.label.length))}│`);
      }
      lines.push(dimFg('textMuted', '  └─────────────────┘'));
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helper: Create breadcrumbs from various sources
// ---------------------------------------------------------------------------

/** Create breadcrumbs from a class/method hierarchy. */
export function createHierarchyCrumbs(hierarchy: string[]): BreadcrumbSegment[] {
  return hierarchy.map((item, i) => ({
    id: `hier-${String(i)}`,
    label: item,
    type: i === 0 ? 'module' : i === hierarchy.length - 1 ? 'method' : 'class',
  }));
}

/** Create breadcrumbs with git branch. */
export function createGitCrumbs(branch: string, path: string): BreadcrumbSegment[] {
  const pathParts = path.split('/').filter((p) => p.length > 0);
  return [
    { id: 'branch', label: branch, type: 'branch', icon: '🌿' },
    ...pathParts.map((part, i) => ({
      id: `path-${String(i)}`,
      label: part,
      type: (i === pathParts.length - 1 ? 'file' : 'folder') as 'file' | 'folder',
    })),
  ];
}
