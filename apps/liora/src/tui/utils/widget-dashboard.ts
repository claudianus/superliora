/**
 * WidgetDashboard — grid of mini widgets for at-a-glance info.
 *
 * Provides a customizable dashboard:
 * - Grid layout with resizable widgets
 * - Widget types: clock, weather, stats, chart, list, gauge
 * - Drag-and-drop reordering (keyboard: move with arrows)
 * - Widget refresh intervals
 * - Collapsible widgets
 * - Widget borders and titles
 * - Color themes per widget
 * - Responsive layout (reflow on resize)
 * - Fullscreen widget mode
 *
 * Visual style:
 * ┌─ Clock ──────────┐ ┌─ CPU Usage ─────────┐
 * │                  │ │                     │
 * │    14:32:05      │ │  ████████░░ 78%     │
 * │    Wed, Jul 22   │ │                     │
 * └──────────────────┘ └─────────────────────┘
 * ┌─ Tasks ──────────────────────────────────┐
 * │ ☐ Fix login bug                          │
 * │ ☑ Update documentation                   │
 * │ ☐ Write tests                            │
 * └──────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WidgetType = 'clock' | 'gauge' | 'list' | 'chart' | 'text' | 'stats';

export interface WidgetPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Widget {
  readonly id: string;
  readonly type: WidgetType;
  readonly title: string;
  readonly position: WidgetPosition;
  readonly collapsed?: boolean;
  readonly data?: unknown;
  readonly refreshInterval?: number; // ms
  readonly lastRefresh?: number;
}

export interface ClockWidgetData {
  readonly time: Date;
  readonly format?: '12h' | '24h';
  readonly showDate?: boolean;
}

export interface GaugeWidgetData {
  readonly value: number; // 0-1
  readonly label?: string;
  readonly color?: string;
  readonly thresholds?: { warning: number; critical: number };
}

export interface ListWidgetData {
  readonly items: { text: string; checked?: boolean; icon?: string }[];
  readonly maxVisible?: number;
}

export interface ChartWidgetData {
  readonly values: number[];
  readonly type?: 'bar' | 'line' | 'spark';
  readonly color?: string;
}

export interface StatsWidgetData {
  readonly stats: { label: string; value: string; trend?: 'up' | 'down' | 'flat' }[];
}

export interface DashboardRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showBorders?: boolean;
  readonly showTitles?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// WidgetDashboard
// ---------------------------------------------------------------------------

export class WidgetDashboard {
  private widgets: Map<string, Widget> = new Map();
  private selectedWidgetId: string | null = null;
  private counter = 0;

  // ─── Widget Management ───────────────────────────────────────────

  /** Add a widget. */
  addWidget(widget: Omit<Widget, 'id'> & { id?: string }): string {
    const id = widget.id ?? `widget-${String(++this.counter)}`;
    this.widgets.set(id, { ...widget, id });
    return id;
  }

  /** Remove a widget. */
  removeWidget(id: string): void {
    this.widgets.delete(id);
    if (this.selectedWidgetId === id) {
      this.selectedWidgetId = null;
    }
  }

  /** Get a widget. */
  getWidget(id: string): Widget | undefined {
    return this.widgets.get(id);
  }

  /** Get all widgets. */
  getWidgets(): Widget[] {
    return [...this.widgets.values()];
  }

  /** Update widget data. */
  updateWidgetData(id: string, data: unknown): void {
    const widget = this.widgets.get(id);
    if (widget) {
      this.widgets.set(id, { ...widget, data, lastRefresh: Date.now() });
    }
  }

  /** Toggle widget collapse. */
  toggleCollapse(id: string): void {
    const widget = this.widgets.get(id);
    if (widget) {
      this.widgets.set(id, { ...widget, collapsed: !widget.collapsed });
    }
  }

  /** Move widget position. */
  moveWidget(id: string, dx: number, dy: number): void {
    const widget = this.widgets.get(id);
    if (widget) {
      this.widgets.set(id, {
        ...widget,
        position: {
          ...widget.position,
          x: Math.max(0, widget.position.x + dx),
          y: Math.max(0, widget.position.y + dy),
        },
      });
    }
  }

  /** Resize widget. */
  resizeWidget(id: string, dw: number, dh: number): void {
    const widget = this.widgets.get(id);
    if (widget) {
      this.widgets.set(id, {
        ...widget,
        position: {
          ...widget.position,
          width: Math.max(10, widget.position.width + dw),
          height: Math.max(3, widget.position.height + dh),
        },
      });
    }
  }

  // ─── Selection ───────────────────────────────────────────────────

  /** Select a widget. */
  select(id: string | null): void {
    this.selectedWidgetId = id;
  }

  /** Get selected widget. */
  getSelected(): Widget | null {
    return this.selectedWidgetId ? this.widgets.get(this.selectedWidgetId) ?? null : null;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the dashboard. */
  render(options: DashboardRenderOptions): string[] {
    const { width, height, showBorders = true, showTitles = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Sort widgets by position (top to bottom, left to right)
    const sortedWidgets = [...this.widgets.values()].sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    });

    // Simple row-based layout
    let currentRow: Widget[] = [];
    let rowWidth = 0;

    for (const widget of sortedWidgets) {
      const widgetWidth = widget.position.width;

      if (rowWidth + widgetWidth > width && currentRow.length > 0) {
        // Render current row
        lines.push(...this.renderWidgetRow(currentRow, options));
        currentRow = [];
        rowWidth = 0;
      }

      currentRow.push(widget);
      rowWidth += widgetWidth + 1;
    }

    // Render last row
    if (currentRow.length > 0) {
      lines.push(...this.renderWidgetRow(currentRow, options));
    }

    if (lines.length === 0) {
      lines.push(dimFg('textMuted', '  (no widgets)'));
    }

    return lines.slice(0, height);
  }

  private renderWidgetRow(widgets: Widget[], options: DashboardRenderOptions): string[] {
    const { showBorders = true, showTitles = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Calculate max height in row
    const maxHeight = Math.max(...widgets.map((w) => (w.collapsed ? 1 : w.position.height)));

    // Render each line of the row
    for (let lineIdx = 0; lineIdx < maxHeight; lineIdx++) {
      let line = '';

      for (const widget of widgets) {
        const widgetLines = this.renderWidget(widget, options);
        const widgetLine = widgetLines[lineIdx] ?? '';
        const padded = this.padRight(widgetLine, widget.position.width);
        line += padded + ' ';
      }

      lines.push(line.trimEnd());
    }

    return lines;
  }

  private renderWidget(widget: Widget, options: DashboardRenderOptions): string[] {
    const { showBorders = true, showTitles = true, fg, boldFg, dimFg } = options;
    const { width, height } = widget.position;
    const lines: string[] = [];
    const innerWidth = width - (showBorders ? 2 : 0);
    const isSelected = widget.id === this.selectedWidgetId;

    const border = isSelected ? fg('accent', '│') : fg('textMuted', '│');
    const topBorder = isSelected ? fg('accent', '┌') : fg('textMuted', '┌');
    const bottomBorder = isSelected ? fg('accent', '└') : fg('textMuted', '└');

    // Title bar
    if (showBorders) {
      const collapseIcon = widget.collapsed ? '▸' : '▾';
      const title = showTitles ? ` ${collapseIcon} ${widget.title} ` : '';
      const titleTrunc = title.slice(0, innerWidth);
      lines.push(`${topBorder}${fg('textMuted', titleTrunc)}${fg('textMuted', '─'.repeat(Math.max(0, innerWidth - titleTrunc.length)))}┐`);
    }

    if (widget.collapsed) {
      if (showBorders) {
        lines.push(`${bottomBorder}${fg('textMuted', '─'.repeat(innerWidth))}┘`);
      }
      return lines;
    }

    // Content based on type
    const contentLines = this.renderWidgetContent(widget, innerWidth, height - 2, options);

    for (const contentLine of contentLines) {
      if (showBorders) {
        lines.push(`${border}${contentLine}${border}`);
      } else {
        lines.push(contentLine);
      }
    }

    // Bottom border
    if (showBorders) {
      lines.push(`${bottomBorder}${fg('textMuted', '─'.repeat(innerWidth))}┘`);
    }

    return lines;
  }

  private renderWidgetContent(widget: Widget, width: number, height: number, options: DashboardRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    switch (widget.type) {
      case 'clock': {
        const data = widget.data as ClockWidgetData | undefined;
        const time = data?.time ?? new Date();
        const format = data?.format ?? '24h';

        const hours = format === '12h' ? time.getHours() % 12 || 12 : time.getHours();
        const timeStr = `${String(hours).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
        const ampm = format === '12h' ? (time.getHours() >= 12 ? ' PM' : ' AM') : '';

        lines.push('');
        lines.push(this.padCenter(boldFg('text', `${timeStr}${ampm}`), width));

        if (data?.showDate !== false) {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const dateStr = `${days[time.getDay()]}, ${months[time.getMonth()]} ${String(time.getDate())}`;
          lines.push(this.padCenter(dimFg('textMuted', dateStr), width));
        }
        lines.push('');
        break;
      }

      case 'gauge': {
        const data = widget.data as GaugeWidgetData | undefined;
        const value = data?.value ?? 0;
        const pct = Math.round(value * 100);

        // Determine color
        let color = 'success';
        if (data?.thresholds) {
          if (value >= data.thresholds.critical) color = 'error';
          else if (value >= data.thresholds.warning) color = 'warning';
        }

        const barWidth = width - 8;
        const filled = Math.round(barWidth * value);
        const bar = fg(color, '█'.repeat(filled)) + dimFg('textDim', '░'.repeat(barWidth - filled));

        lines.push('');
        lines.push(` [${bar}]`);
        lines.push(this.padCenter(boldFg(color, `${String(pct)}%`), width));
        if (data?.label) {
          lines.push(this.padCenter(dimFg('textMuted', data.label), width));
        }
        break;
      }

      case 'list': {
        const data = widget.data as ListWidgetData | undefined;
        const items = data?.items ?? [];
        const maxVisible = data?.maxVisible ?? height;

        for (const item of items.slice(0, maxVisible)) {
          const checkbox = item.checked !== undefined ? (item.checked ? fg('success', '☑') : dimFg('textMuted', '☐')) : '';
          const icon = item.icon ?? '';
          const text = item.text.slice(0, width - 4);
          lines.push(` ${checkbox} ${icon} ${fg('text', text)}`);
        }

        if (items.length > maxVisible) {
          lines.push(dimFg('textMuted', ` +${String(items.length - maxVisible)} more...`));
        }
        break;
      }

      case 'chart': {
        const data = widget.data as ChartWidgetData | undefined;
        const values = data?.values ?? [];
        const maxVal = Math.max(...values, 1);

        // Simple bar chart
        const barWidth = Math.floor(width / values.length) - 1;
        for (let i = 0; i < Math.min(values.length, height); i++) {
          const val = values[i] ?? 0;
          const barLen = Math.round((val / maxVal) * (width - 6));
          const bar = fg('primary', '█'.repeat(barLen));
          lines.push(` ${bar} ${dimFg('textMuted', String(val))}`);
        }
        break;
      }

      case 'stats': {
        const data = widget.data as StatsWidgetData | undefined;
        const stats = data?.stats ?? [];

        for (const stat of stats.slice(0, height)) {
          const trendIcon = stat.trend === 'up' ? fg('success', '↑') : stat.trend === 'down' ? fg('error', '↓') : dimFg('textMuted', '→');
          lines.push(` ${dimFg('textMuted', stat.label)}: ${boldFg('text', stat.value)} ${trendIcon}`);
        }
        break;
      }

      case 'text': {
        const text = (widget.data as string) ?? '';
        const textLines = text.split('\n').slice(0, height);
        for (const line of textLines) {
          lines.push(` ${fg('text', line.slice(0, width - 2))}`);
        }
        break;
      }
    }

    // Pad to height
    while (lines.length < height) {
      lines.push(' '.repeat(width));
    }

    return lines.slice(0, height);
  }

  private padCenter(text: string, width: number): string {
    const plainLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - plainLen);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }

  private padRight(text: string, width: number): string {
    const plainLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    return text + ' '.repeat(Math.max(0, width - plainLen));
  }
}

// ---------------------------------------------------------------------------
// Helper: Create default dashboard
// ---------------------------------------------------------------------------

/** Create a dashboard with common widgets. */
export function createDefaultDashboard(): WidgetDashboard {
  const dashboard = new WidgetDashboard();

  dashboard.addWidget({
    type: 'clock',
    title: 'Clock',
    position: { x: 0, y: 0, width: 24, height: 5 },
    data: { time: new Date(), format: '24h', showDate: true },
  });

  dashboard.addWidget({
    type: 'gauge',
    title: 'CPU',
    position: { x: 25, y: 0, width: 24, height: 5 },
    data: { value: 0.45, label: '4 cores', thresholds: { warning: 0.7, critical: 0.9 } },
  });

  dashboard.addWidget({
    type: 'list',
    title: 'Tasks',
    position: { x: 0, y: 6, width: 50, height: 6 },
    data: {
      items: [
        { text: 'Fix login bug', checked: false, icon: '🐛' },
        { text: 'Update docs', checked: true, icon: '📝' },
        { text: 'Write tests', checked: false, icon: '🧪' },
      ],
    },
  });

  return dashboard;
}
