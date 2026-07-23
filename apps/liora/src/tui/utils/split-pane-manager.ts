/**
 * SplitPaneManager — resizable split panes for multi-session parallel work.
 *
 * Implements a binary-tree layout system for terminal panes:
 * - Horizontal and vertical splits with recursive nesting
 * - Draggable resize handles (mouse + keyboard)
 * - Focus management with directional navigation (vim-style hjkl)
 * - Minimum size constraints with proportional redistribution
 * - Smooth resize animation (ease-out interpolation)
 * - Box-drawing borders with active pane highlight
 * - Pane lifecycle: create, split, close, maximize/restore
 * - Layout presets: equal, golden-ratio, sidebar, quad
 * - Session binding: each pane can host an independent session
 *
 * Architecture:
 * - Binary tree: each node is either a Leaf (pane) or a Split (two children)
 * - Split ratio: 0.0-1.0 representing the proportion of space for the first child
 * - Resize: adjust ratio with clamping to respect min sizes
 * - Focus: tracked by pane ID, directional nav traverses the tree
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneInfo {
  readonly id: string;
  readonly title: string;
  readonly sessionId?: string;
  /** Computed layout region (absolute terminal coordinates). */
  x: number;
  y: number;
  width: number;
  height: number;
  readonly focused: boolean;
  readonly maximized: boolean;
}

export interface SplitNode {
  readonly type: 'leaf' | 'split';
}

export interface LeafNode extends SplitNode {
  readonly type: 'leaf';
  readonly paneId: string;
  title: string;
  sessionId?: string;
}

export interface SplitNodeInternal extends SplitNode {
  readonly type: 'split';
  direction: SplitDirection;
  /** Ratio of space allocated to `first` child (0.0-1.0). */
  ratio: number;
  first: TreeNode;
  second: TreeNode;
}

export type TreeNode = LeafNode | SplitNodeInternal;

export interface SplitRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface ResizeAnimation {
  readonly paneId: string;
  readonly fromRatio: number;
  readonly toRatio: number;
  readonly startTime: number;
  readonly duration: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PANE_WIDTH = 10;
const MIN_PANE_HEIGHT = 4;
const RESIZE_STEP = 0.02; // 2% per keypress
const ANIMATION_DURATION_MS = 150;
const BORDER_CHARS = {
  horizontal: '─',
  vertical: '│',
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
  activeHorizontal: '━',
  activeVertical: '┃',
  activeTopLeft: '┏',
  activeTopRight: '┓',
  activeBottomLeft: '┗',
  activeBottomRight: '┛',
};

// ---------------------------------------------------------------------------
// SplitPaneManager
// ---------------------------------------------------------------------------

export class SplitPaneManager {
  private root: TreeNode | null = null;
  private focusedPaneId: string | null = null;
  private maximizedPaneId: string | null = null;
  private paneCounter = 0;
  private animations: ResizeAnimation[] = [];
  private savedLayout: TreeNode | null = null; // For maximize/restore

  // ─── Pane Lifecycle ──────────────────────────────────────────────

  /** Create the initial pane (replaces any existing layout). */
  createInitialPane(title: string = 'Main', sessionId?: string): string {
    const id = this.nextPaneId();
    this.root = { type: 'leaf', paneId: id, title, sessionId };
    this.focusedPaneId = id;
    return id;
  }

  /** Split a pane into two. Returns the new pane's ID. */
  splitPane(paneId: string, direction: SplitDirection, newTitle?: string, sessionId?: string): string | null {
    const node = this.findNode(paneId);
    if (!node || node.type !== 'leaf') return null;

    const newId = this.nextPaneId();
    const newLeaf: LeafNode = {
      type: 'leaf',
      paneId: newId,
      title: newTitle ?? `Pane ${String(this.paneCounter)}`,
      sessionId,
    };

    const splitNode: SplitNodeInternal = {
      type: 'split',
      direction,
      ratio: 0.5,
      first: node,
      second: newLeaf,
    };

    this.replaceNode(paneId, splitNode);
    this.focusedPaneId = newId;
    return newId;
  }

  /** Close a pane and redistribute space to its sibling. */
  closePane(paneId: string): boolean {
    if (!this.root) return false;

    // If it's the only pane, clear everything
    if (this.root.type === 'leaf' && this.root.paneId === paneId) {
      this.root = null;
      this.focusedPaneId = null;
      return true;
    }

    const sibling = this.findSibling(paneId);
    if (!sibling) return false;

    // Replace the parent split with the sibling
    this.replaceParentWithSibling(paneId, sibling);

    // Update focus
    if (this.focusedPaneId === paneId) {
      this.focusedPaneId = sibling.type === 'leaf' ? sibling.paneId : this.firstLeaf(sibling)?.paneId ?? null;
    }

    return true;
  }

  /** Maximize a pane to fill the entire viewport. */
  maximizePane(paneId: string): void {
    if (this.maximizedPaneId === paneId) return;
    this.savedLayout = this.root;
    this.maximizedPaneId = paneId;
  }

  /** Restore from maximized state. */
  restorePane(): void {
    if (this.savedLayout) {
      this.root = this.savedLayout;
      this.savedLayout = null;
    }
    this.maximizedPaneId = null;
  }

  /** Toggle maximize/restore for a pane. */
  toggleMaximize(paneId: string): void {
    if (this.maximizedPaneId === paneId) {
      this.restorePane();
    } else {
      this.maximizePane(paneId);
    }
  }

  // ─── Focus Management ────────────────────────────────────────────

  /** Set focus to a specific pane. */
  focusPane(paneId: string): boolean {
    const node = this.findNode(paneId);
    if (!node) return false;
    this.focusedPaneId = paneId;
    return true;
  }

  /** Navigate focus in a direction (vim-style: h=left, j=down, k=up, l=right). */
  navigateFocus(direction: 'left' | 'right' | 'up' | 'down'): boolean {
    if (!this.focusedPaneId || !this.root) return false;

    const panes = this.computeLayout(this.root, 0, 0, 80, 24);
    const current = panes.find((p) => p.id === this.focusedPaneId);
    if (!current) return false;

    const cx = current.x + current.width / 2;
    const cy = current.y + current.height / 2;

    let best: PaneInfo | null = null;
    let bestScore = Infinity;

    for (const pane of panes) {
      if (pane.id === this.focusedPaneId) continue;
      const px = pane.x + pane.width / 2;
      const py = pane.y + pane.height / 2;

      let valid = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      switch (direction) {
        case 'left':
          valid = px < cx;
          primaryDist = cx - px;
          secondaryDist = Math.abs(py - cy);
          break;
        case 'right':
          valid = px > cx;
          primaryDist = px - cx;
          secondaryDist = Math.abs(py - cy);
          break;
        case 'up':
          valid = py < cy;
          primaryDist = cy - py;
          secondaryDist = Math.abs(px - cx);
          break;
        case 'down':
          valid = py > cy;
          primaryDist = py - cy;
          secondaryDist = Math.abs(px - cx);
          break;
      }

      if (valid) {
        const score = primaryDist + secondaryDist * 2;
        if (score < bestScore) {
          bestScore = score;
          best = pane;
        }
      }
    }

    if (best) {
      this.focusedPaneId = best.id;
      return true;
    }
    return false;
  }

  /** Cycle focus to the next pane. */
  cycleFocus(reverse: boolean = false): void {
    const leaves = this.collectLeaves(this.root);
    if (leaves.length <= 1) return;

    const currentIdx = leaves.findIndex((l) => l.paneId === this.focusedPaneId);
    const nextIdx = reverse
      ? (currentIdx - 1 + leaves.length) % leaves.length
      : (currentIdx + 1) % leaves.length;
    this.focusedPaneId = leaves[nextIdx]!.paneId;
  }

  get focusedId(): string | null {
    return this.focusedPaneId;
  }

  // ─── Resize ──────────────────────────────────────────────────────

  /** Resize a split by adjusting its ratio. Positive delta grows the first child. */
  resize(paneId: string, delta: number): void {
    const parent = this.findParentSplit(paneId);
    if (!parent) return;

    const newRatio = Math.max(0.15, Math.min(0.85, parent.ratio + delta));
    parent.ratio = newRatio;
  }

  /** Resize with keyboard (one step). */
  resizeStep(paneId: string, direction: 'grow' | 'shrink'): void {
    const delta = direction === 'grow' ? RESIZE_STEP : -RESIZE_STEP;
    this.resize(paneId, delta);
  }

  /** Resize with animation. */
  resizeAnimated(paneId: string, targetRatio: number): void {
    const parent = this.findParentSplit(paneId);
    if (!parent) return;

    this.animations.push({
      paneId,
      fromRatio: parent.ratio,
      toRatio: Math.max(0.15, Math.min(0.85, targetRatio)),
      startTime: Date.now(),
      duration: ANIMATION_DURATION_MS,
    });
  }

  /** Tick animations. Call each frame. */
  tick(): boolean {
    const now = Date.now();
    let active = false;

    this.animations = this.animations.filter((anim) => {
      const elapsed = now - anim.startTime;
      const t = Math.min(1, elapsed / anim.duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

      const parent = this.findParentSplit(anim.paneId);
      if (parent) {
        parent.ratio = anim.fromRatio + (anim.toRatio - anim.fromRatio) * eased;
      }

      if (t >= 1) return false;
      active = true;
      return true;
    });

    return active;
  }

  // ─── Layout Computation ──────────────────────────────────────────

  /** Compute absolute positions for all panes. */
  computeLayout(node: TreeNode | null, x: number, y: number, width: number, height: number): PaneInfo[] {
    if (!node) return [];

    // If maximized, show only the maximized pane
    if (this.maximizedPaneId) {
      const maxLeaf = this.findLeafById(this.maximizedPaneId);
      if (maxLeaf) {
        return [{
          id: maxLeaf.paneId,
          title: maxLeaf.title,
          sessionId: maxLeaf.sessionId,
          x, y, width, height,
          focused: maxLeaf.paneId === this.focusedPaneId,
          maximized: true,
        }];
      }
    }

    return this.computeNodeLayout(node, x, y, width, height);
  }

  private computeNodeLayout(node: TreeNode, x: number, y: number, width: number, height: number): PaneInfo[] {
    if (node.type === 'leaf') {
      return [{
        id: node.paneId,
        title: node.title,
        sessionId: node.sessionId,
        x, y, width, height,
        focused: node.paneId === this.focusedPaneId,
        maximized: false,
      }];
    }

    const split = node;
    const borderSize = 1;

    if (split.direction === 'horizontal') {
      // Split top/bottom
      const firstHeight = Math.max(MIN_PANE_HEIGHT, Math.round((height - borderSize) * split.ratio));
      const secondHeight = height - firstHeight - borderSize;

      return [
        ...this.computeNodeLayout(split.first, x, y, width, firstHeight),
        ...this.computeNodeLayout(split.second, x, y + firstHeight + borderSize, width, secondHeight),
      ];
    } else {
      // Split left/right
      const firstWidth = Math.max(MIN_PANE_WIDTH, Math.round((width - borderSize) * split.ratio));
      const secondWidth = width - firstWidth - borderSize;

      return [
        ...this.computeNodeLayout(split.first, x, y, firstWidth, height),
        ...this.computeNodeLayout(split.second, x + firstWidth + borderSize, y, secondWidth, height),
      ];
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the full split layout with borders. */
  render(options: SplitRenderOptions): string[] {
    const { width, height, fg, boldFg, dimFg } = options;
    const panes = this.computeLayout(this.root, 0, 0, width, height);
    if (panes.length === 0) return [dimFg('textMuted', '  (no panes)')];

    const lines: string[] = [];

    // Header showing layout info
    const paneCount = panes.length;
    const layoutDesc = this.describeLayout();
    lines.push(boldFg('text', ` Panes: ${String(paneCount)}`) + dimFg('textMuted', ` ${layoutDesc}`));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 60))));

    // Render each pane as a box
    for (const pane of panes) {
      const isActive = pane.focused;
      const border = isActive ? fg('accent', '┃') : fg('textMuted', '│');
      const topBorder = isActive ? fg('accent', '┏') : fg('textMuted', '┌');
      const botBorder = isActive ? fg('accent', '┗') : fg('textMuted', '└');
      const hChar = isActive ? fg('accent', '━') : fg('textMuted', '─');

      const innerWidth = Math.max(1, pane.width - 4);
      const title = isActive
        ? boldFg('accent', ` ${pane.title} `)
        : fg('textMuted', ` ${pane.title} `);
      const sessionBadge = pane.sessionId ? dimFg('textMuted', `[${pane.sessionId}]`) : '';
      const maxBadge = pane.maximized ? fg('warning', ' ⛶') : '';

      // Top border with title
      const titleLen = pane.title.length + 2;
      const remainTop = Math.max(0, innerWidth - titleLen - sessionBadge.length);
      lines.push(`${topBorder}${title}${sessionBadge}${maxBadge}${hChar.repeat(remainTop)}${isActive ? fg('accent', '┓') : fg('textMuted', '┐')}`);

      // Content area (show dimensions)
      const contentLine = dimFg('textMuted', `  ${String(pane.width)}×${String(pane.height)}`) +
        (isActive ? fg('success', ' ●') : '');
      lines.push(`${border}${contentLine}${' '.repeat(Math.max(0, innerWidth - stripAnsiLen(contentLine)))}${border}`);

      // Bottom border
      lines.push(`${botBorder}${hChar.repeat(innerWidth)}${isActive ? fg('accent', '┛') : fg('textMuted', '┘')}`);
      lines.push('');
    }

    return lines;
  }

  /** Render a compact layout map (bird's-eye view). */
  renderMiniMap(options: SplitRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const panes = this.computeLayout(this.root, 0, 0, width, 20);
    if (panes.length === 0) return [];

    const lines: string[] = [];
    lines.push(dimFg('textMuted', ' Layout:'));

    // Simple text representation
    for (const pane of panes) {
      const marker = pane.focused ? fg('accent', '▸') : ' ';
      const label = pane.focused ? boldFg('accent', pane.title) : fg('text', pane.title);
      lines.push(`  ${marker} ${label} ${dimFg('textMuted', `${String(pane.width)}×${String(pane.height)}`)}`);
    }

    return lines;
  }

  // ─── Layout Presets ──────────────────────────────────────────────

  /** Apply an equal split layout for N panes. */
  applyPreset(preset: 'equal-2h' | 'equal-2v' | 'golden-v' | 'sidebar' | 'quad'): void {
    switch (preset) {
      case 'equal-2h': {
        const id1 = this.createInitialPane('Top');
        this.splitPane(id1, 'horizontal', 'Bottom');
        this.focusedPaneId = id1;
        break;
      }
      case 'equal-2v': {
        const id1 = this.createInitialPane('Left');
        this.splitPane(id1, 'vertical', 'Right');
        this.focusedPaneId = id1;
        break;
      }
      case 'golden-v': {
        const id1 = this.createInitialPane('Main');
        this.splitPane(id1, 'vertical', 'Side');
        // Set golden ratio (0.618)
        if (this.root && this.root.type === 'split') {
          this.root.ratio = 0.618;
        }
        this.focusedPaneId = id1;
        break;
      }
      case 'sidebar': {
        const id1 = this.createInitialPane('Editor');
        this.splitPane(id1, 'vertical', 'Sidebar');
        if (this.root && this.root.type === 'split') {
          this.root.ratio = 0.75;
        }
        this.focusedPaneId = id1;
        break;
      }
      case 'quad': {
        const id1 = this.createInitialPane('Top-Left');
        this.splitPane(id1, 'horizontal', 'Bottom-Left');
        // Now split the root's first child vertically
        if (this.root && this.root.type === 'split') {
          const topLeft = this.root.first;
          const botLeft = this.root.second;
          const id2 = this.nextPaneId();
          const id3 = this.nextPaneId();
          this.root = {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            first: {
              type: 'split',
              direction: 'horizontal',
              ratio: 0.5,
              first: topLeft,
              second: { type: 'leaf', paneId: id2, title: 'Top-Right' },
            },
            second: {
              type: 'split',
              direction: 'horizontal',
              ratio: 0.5,
              first: botLeft,
              second: { type: 'leaf', paneId: id3, title: 'Bottom-Right' },
            },
          };
        }
        this.focusedPaneId = 'pane-1';
        break;
      }
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all pane IDs. */
  getPaneIds(): string[] {
    return this.collectLeaves(this.root).map((l) => l.paneId);
  }

  /** Get pane count. */
  get paneCount(): number {
    return this.collectLeaves(this.root).length;
  }

  /** Get info about a specific pane. */
  getPaneInfo(paneId: string, viewportWidth: number = 80, viewportHeight: number = 24): PaneInfo | null {
    const panes = this.computeLayout(this.root, 0, 0, viewportWidth, viewportHeight);
    return panes.find((p) => p.id === paneId) ?? null;
  }

  /** Describe the current layout structure. */
  describeLayout(): string {
    if (!this.root) return 'empty';
    return this.describeNode(this.root);
  }

  private describeNode(node: TreeNode): string {
    if (node.type === 'leaf') return node.title;
    const sep = node.direction === 'horizontal' ? '╱' : '╲';
    return `(${this.describeNode(node.first)} ${sep} ${this.describeNode(node.second)})`;
  }

  // ─── Tree Operations (Internal) ─────────────────────────────────

  private nextPaneId(): string {
    this.paneCounter++;
    return `pane-${String(this.paneCounter)}`;
  }

  private findNode(paneId: string): TreeNode | null {
    return this.findInTree(this.root, paneId);
  }

  private findInTree(node: TreeNode | null, paneId: string): TreeNode | null {
    if (!node) return null;
    if (node.type === 'leaf') {
      return node.paneId === paneId ? node : null;
    }
    return this.findInTree(node.first, paneId) ?? this.findInTree(node.second, paneId);
  }

  private findLeafById(paneId: string): LeafNode | null {
    const node = this.findNode(paneId);
    return node?.type === 'leaf' ? node : null;
  }

  private replaceNode(paneId: string, replacement: TreeNode): void {
    if (!this.root) return;
    if (this.root.type === 'leaf' && this.root.paneId === paneId) {
      this.root = replacement;
      return;
    }
    this.replaceInTree(this.root, paneId, replacement);
  }

  private replaceInTree(node: TreeNode, paneId: string, replacement: TreeNode): boolean {
    if (node.type !== 'split') return false;

    if (node.first.type === 'leaf' && node.first.paneId === paneId) {
      node.first = replacement;
      return true;
    }
    if (node.second.type === 'leaf' && node.second.paneId === paneId) {
      node.second = replacement;
      return true;
    }
    return this.replaceInTree(node.first, paneId, replacement) ||
           this.replaceInTree(node.second, paneId, replacement);
  }

  private findSibling(paneId: string): TreeNode | null {
    return this.findSiblingInTree(this.root, paneId);
  }

  private findSiblingInTree(node: TreeNode | null, paneId: string): TreeNode | null {
    if (!node || node.type !== 'split') return null;

    if (node.first.type === 'leaf' && node.first.paneId === paneId) return node.second;
    if (node.second.type === 'leaf' && node.second.paneId === paneId) return node.first;

    return this.findSiblingInTree(node.first, paneId) ?? this.findSiblingInTree(node.second, paneId);
  }

  private replaceParentWithSibling(paneId: string, sibling: TreeNode): void {
    if (!this.root || this.root.type !== 'split') return;

    // Check if root's children contain the pane
    if ((this.root.first.type === 'leaf' && this.root.first.paneId === paneId) ||
        (this.root.second.type === 'leaf' && this.root.second.paneId === paneId)) {
      this.root = sibling;
      return;
    }

    this.replaceParentInTree(this.root, paneId, sibling);
  }

  private replaceParentInTree(node: TreeNode, paneId: string, sibling: TreeNode): boolean {
    if (node.type !== 'split') return false;

    if (node.first.type === 'split') {
      const f = node.first;
      if ((f.first.type === 'leaf' && f.first.paneId === paneId) ||
          (f.second.type === 'leaf' && f.second.paneId === paneId)) {
        node.first = sibling;
        return true;
      }
    }
    if (node.second.type === 'split') {
      const s = node.second;
      if ((s.first.type === 'leaf' && s.first.paneId === paneId) ||
          (s.second.type === 'leaf' && s.second.paneId === paneId)) {
        node.second = sibling;
        return true;
      }
    }

    return this.replaceParentInTree(node.first, paneId, sibling) ||
           this.replaceParentInTree(node.second, paneId, sibling);
  }

  private findParentSplit(paneId: string): SplitNodeInternal | null {
    return this.findParentInTree(this.root, paneId);
  }

  private findParentInTree(node: TreeNode | null, paneId: string): SplitNodeInternal | null {
    if (!node || node.type !== 'split') return null;

    if ((node.first.type === 'leaf' && node.first.paneId === paneId) ||
        (node.second.type === 'leaf' && node.second.paneId === paneId)) {
      return node;
    }

    return this.findParentInTree(node.first, paneId) ?? this.findParentInTree(node.second, paneId);
  }

  private collectLeaves(node: TreeNode | null): LeafNode[] {
    if (!node) return [];
    if (node.type === 'leaf') return [node];
    return [...this.collectLeaves(node.first), ...this.collectLeaves(node.second)];
  }

  private firstLeaf(node: TreeNode): LeafNode | null {
    if (node.type === 'leaf') return node;
    return this.firstLeaf(node.first);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}
