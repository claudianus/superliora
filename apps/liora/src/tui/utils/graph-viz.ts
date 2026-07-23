/**
 * GraphViz — node/edge graph and flowchart visualization.
 *
 * Provides terminal-based graph rendering:
 * - Directed/undirected graphs
 * - Node shapes (box, circle, diamond, ellipse)
 * - Edge styles (solid, dashed, dotted, bold)
 * - Edge labels
 * - Automatic layout (simple layered/hierarchical)
 * - Manual positioning
 * - Node colors and icons
 * - Highlight paths
 * - Zoom/pan state
 * - ASCII art connectors
 * - Flowchart support (start/end/process/decision)
 *
 * Visual style:
 * ┌─────────┐     ┌─────────┐     ┌─────────┐
 * │  Start  │────▶│ Process │────▶│   End   │
 * └─────────┘     └────┬────┘     └─────────┘
 *                      │
 *                      ▼
 *                 ┌─────────┐
 *                 │Decision │
 *                 └─────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeShape = 'box' | 'circle' | 'diamond' | 'ellipse' | 'cylinder' | 'parallelogram';

export type EdgeStyle = 'solid' | 'dashed' | 'dotted' | 'bold';

export type EdgeDirection = 'forward' | 'backward' | 'both' | 'none';

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly shape?: NodeShape;
  readonly icon?: string;
  readonly color?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly metadata?: Record<string, string>;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style?: EdgeStyle;
  readonly direction?: EdgeDirection;
  readonly color?: string;
}

export interface GraphRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showEdgeLabels?: boolean;
  readonly highlightPath?: string[]; // Node IDs to highlight
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface LayoutResult {
  readonly nodes: Map<string, { x: number; y: number; width: number; height: number }>;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHAPE_BORDERS: Record<NodeShape, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
  box: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  circle: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  diamond: { tl: '◇', tr: '◇', bl: '◇', br: '◇', h: '─', v: '│' },
  ellipse: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  cylinder: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '═', v: '║' },
  parallelogram: { tl: '╱', tr: '┐', bl: '└', br: '╲', h: '─', v: '│' },
};

const EDGE_CHARS: Record<EdgeStyle, { h: string; v: string }> = {
  solid: { h: '─', v: '│' },
  dashed: { h: '╌', v: '┆' },
  dotted: { h: '┄', v: '┊' },
  bold: { h: '━', v: '┃' },
};

const ARROW_HEADS: Record<EdgeDirection, { right: string; left: string }> = {
  forward: { right: '▶', left: '' },
  backward: { right: '', left: '◀' },
  both: { right: '▶', left: '◀' },
  none: { right: '', left: '' },
};

// ---------------------------------------------------------------------------
// GraphViz
// ---------------------------------------------------------------------------

export class GraphViz {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private layout: LayoutResult | null = null;

  // ─── Node Management ─────────────────────────────────────────────

  /** Add a node. */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    this.layout = null; // Invalidate layout
  }

  /** Remove a node and its edges. */
  removeNode(id: string): void {
    this.nodes.delete(id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.layout = null;
  }

  /** Get a node. */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /** Get all nodes. */
  getNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  // ─── Edge Management ─────────────────────────────────────────────

  /** Add an edge. */
  addEdge(edge: Omit<GraphEdge, 'id'> & { id?: string }): string {
    const id = edge.id ?? `edge-${String(this.edges.length + 1)}`;
    this.edges.push({ ...edge, id });
    this.layout = null;
    return id;
  }

  /** Remove an edge. */
  removeEdge(id: string): void {
    this.edges = this.edges.filter((e) => e.id !== id);
    this.layout = null;
  }

  /** Get all edges. */
  getEdges(): readonly GraphEdge[] {
    return this.edges;
  }

  /** Get edges connected to a node. */
  getNodeEdges(nodeId: string): GraphEdge[] {
    return this.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  }

  // ─── Layout ──────────────────────────────────────────────────────

  /** Calculate a simple layered layout. */
  calculateLayout(): LayoutResult {
    if (this.layout) return this.layout;

    const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>();

    // Simple topological sort for layered layout
    const layers = this.computeLayers();
    const nodeWidth = 12;
    const nodeHeight = 3;
    const hGap = 6;
    const vGap = 3;

    let maxWidth = 0;

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx]!;
      const layerWidth = layer.length * (nodeWidth + hGap) - hGap;
      maxWidth = Math.max(maxWidth, layerWidth);

      for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
        const nodeId = layer[nodeIdx]!;
        const x = nodeIdx * (nodeWidth + hGap);
        const y = layerIdx * (nodeHeight + vGap);

        nodePositions.set(nodeId, {
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
        });
      }
    }

    // Center layers
    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx]!;
      const layerWidth = layer.length * (nodeWidth + hGap) - hGap;
      const offset = Math.floor((maxWidth - layerWidth) / 2);

      for (const nodeId of layer) {
        const pos = nodePositions.get(nodeId);
        if (pos) {
          nodePositions.set(nodeId, { ...pos, x: pos.x + offset });
        }
      }
    }

    const totalHeight = layers.length * (nodeHeight + vGap) - vGap;

    this.layout = {
      nodes: nodePositions,
      width: maxWidth,
      height: totalHeight,
    };

    return this.layout;
  }

  private computeLayers(): string[][] {
    const layers: string[][] = [];
    const visited = new Set<string>();
    const nodeIds = [...this.nodes.keys()];

    // Find root nodes (no incoming edges)
    const hasIncoming = new Set(this.edges.map((e) => e.to));
    const roots = nodeIds.filter((id) => !hasIncoming.has(id));

    // BFS to assign layers
    let currentLayer = roots.length > 0 ? roots : nodeIds.slice(0, 1);

    while (currentLayer.length > 0 && layers.length < 20) {
      layers.push(currentLayer);
      currentLayer.forEach((id) => visited.add(id));

      const nextLayer: string[] = [];
      for (const nodeId of currentLayer) {
        const outgoing = this.edges.filter((e) => e.from === nodeId);
        for (const edge of outgoing) {
          if (!visited.has(edge.to) && !nextLayer.includes(edge.to)) {
            nextLayer.push(edge.to);
          }
        }
      }
      currentLayer = nextLayer;
    }

    // Add any remaining unvisited nodes
    const remaining = nodeIds.filter((id) => !visited.has(id));
    if (remaining.length > 0) {
      layers.push(remaining);
    }

    return layers;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get node count. */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Get edge count. */
  get edgeCount(): number {
    return this.edges.length;
  }

  /** Find path between two nodes (BFS). */
  findPath(fromId: string, toId: string): string[] | null {
    const queue: string[][] = [[fromId]];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1]!;

      if (current === toId) return path;
      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = this.edges
        .filter((e) => e.from === current)
        .map((e) => e.to);

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push([...path, neighbor]);
        }
      }
    }

    return null;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the graph. */
  render(options: GraphRenderOptions): string[] {
    const { width, height, showEdgeLabels = true, highlightPath = [], fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const layout = this.calculateLayout();
    const highlightSet = new Set(highlightPath);

    // Create a canvas
    const canvasWidth = Math.min(width, layout.width + 20);
    const canvasHeight = Math.min(height, layout.height + 10);
    const canvas: string[][] = Array.from({ length: canvasHeight }, () =>
      Array.from({ length: canvasWidth }, () => ' '),
    );

    // Draw edges first (so nodes appear on top)
    for (const edge of this.edges) {
      this.drawEdge(canvas, edge, layout, options);
    }

    // Draw nodes
    for (const [nodeId, node] of this.nodes) {
      const pos = layout.nodes.get(nodeId);
      if (!pos) continue;

      const isHighlighted = highlightSet.has(nodeId);
      this.drawNode(canvas, node, pos, isHighlighted, options);
    }

    // Convert canvas to lines
    for (const row of canvas) {
      lines.push(row.join('').trimEnd());
    }

    return lines.filter((line) => line.length > 0);
  }

  private drawNode(
    canvas: string[][],
    node: GraphNode,
    pos: { x: number; y: number; width: number; height: number },
    highlighted: boolean,
    options: GraphRenderOptions,
  ): void {
    const { fg, boldFg } = options;
    const shape = node.shape ?? 'box';
    const borders = SHAPE_BORDERS[shape];

    const label = node.icon ? `${node.icon} ${node.label}` : node.label;
    const truncated = label.slice(0, pos.width - 2);
    const padded = this.padCenter(truncated, pos.width - 2);

    const color = highlighted ? 'accent' : node.color ?? 'text';
    const renderFn = highlighted ? boldFg : fg;

    // Top border
    this.setCanvasText(canvas, pos.x, pos.y, `${borders.tl}${borders.h.repeat(pos.width - 2)}${borders.tr}`, color, renderFn);

    // Middle (label)
    this.setCanvasText(canvas, pos.x, pos.y + 1, `${borders.v}${padded}${borders.v}`, color, renderFn);

    // Bottom border
    this.setCanvasText(canvas, pos.x, pos.y + 2, `${borders.bl}${borders.h.repeat(pos.width - 2)}${borders.br}`, color, renderFn);
  }

  private drawEdge(
    canvas: string[][],
    edge: GraphEdge,
    layout: LayoutResult,
    options: GraphRenderOptions,
  ): void {
    const { fg, dimFg } = options;
    const fromPos = layout.nodes.get(edge.from);
    const toPos = layout.nodes.get(edge.to);

    if (!fromPos || !toPos) return;

    const style = edge.style ?? 'solid';
    const direction = edge.direction ?? 'forward';
    const edgeChars = EDGE_CHARS[style];
    const arrows = ARROW_HEADS[direction];

    // Calculate connection points
    const fromX = fromPos.x + Math.floor(fromPos.width / 2);
    const fromY = fromPos.y + fromPos.height;
    const toX = toPos.x + Math.floor(toPos.width / 2);
    const toY = toPos.y;

    // Simple vertical edge
    if (fromX === toX) {
      for (let y = fromY; y < toY; y++) {
        if (y >= 0 && y < canvas.length && fromX >= 0 && fromX < canvas[0]!.length) {
          canvas[y]![fromX] = dimFg('textMuted', edgeChars.v);
        }
      }
      // Arrow
      if (arrows.right && toY > 0 && toY < canvas.length) {
        canvas[toY - 1]![toX] = dimFg('textMuted', '▼');
      }
    } else {
      // Horizontal then vertical (L-shaped)
      const midY = Math.floor((fromY + toY) / 2);

      // Vertical from source
      for (let y = fromY; y <= midY; y++) {
        if (y >= 0 && y < canvas.length && fromX >= 0 && fromX < canvas[0]!.length) {
          canvas[y]![fromX] = dimFg('textMuted', edgeChars.v);
        }
      }

      // Horizontal
      const startX = Math.min(fromX, toX);
      const endX = Math.max(fromX, toX);
      for (let x = startX; x <= endX; x++) {
        if (midY >= 0 && midY < canvas.length && x >= 0 && x < canvas[0]!.length) {
          canvas[midY]![x] = dimFg('textMuted', edgeChars.h);
        }
      }

      // Vertical to target
      for (let y = midY; y < toY; y++) {
        if (y >= 0 && y < canvas.length && toX >= 0 && toX < canvas[0]!.length) {
          canvas[y]![toX] = dimFg('textMuted', edgeChars.v);
        }
      }

      // Arrow
      if (arrows.right && toY > 0 && toY < canvas.length) {
        canvas[toY - 1]![toX] = dimFg('textMuted', '▼');
      }
    }

    // Edge label
    if (edge.label && options.showEdgeLabels) {
      const labelX = Math.floor((fromX + toX) / 2);
      const labelY = Math.floor((fromY + toY) / 2);
      if (labelY >= 0 && labelY < canvas.length) {
        this.setCanvasText(canvas, labelX + 1, labelY, dimFg('textDim', edge.label), 'textDim', dimFg);
      }
    }
  }

  private setCanvasText(
    canvas: string[][],
    x: number,
    y: number,
    text: string,
    _color: string,
    _renderFn: (token: string, text: string) => string,
  ): void {
    if (y < 0 || y >= canvas.length) return;

    const row = canvas[y]!;
    // Strip ANSI for length calculation
    const plainText = text.replace(/\x1b\[[0-9;]*m/g, '');

    for (let i = 0; i < plainText.length && x + i < row.length; i++) {
      // For simplicity, just set the character (ANSI handling would be more complex)
      if (x + i >= 0) {
        row[x + i] = plainText[i] ?? ' ';
      }
    }
  }

  private padCenter(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
}

// ---------------------------------------------------------------------------
// Helper: Create flowchart
// ---------------------------------------------------------------------------

/** Create a simple flowchart from steps. */
export function createFlowchart(steps: { id: string; label: string; type?: 'start' | 'end' | 'process' | 'decision' }[]): GraphViz {
  const graph = new GraphViz();

  for (const step of steps) {
    const shape: NodeShape = step.type === 'start' || step.type === 'end'
      ? 'ellipse'
      : step.type === 'decision'
        ? 'diamond'
        : 'box';

    graph.addNode({
      id: step.id,
      label: step.label,
      shape,
    });
  }

  // Connect sequentially
  for (let i = 0; i < steps.length - 1; i++) {
    graph.addEdge({
      from: steps[i]!.id,
      to: steps[i + 1]!.id,
    });
  }

  return graph;
}
