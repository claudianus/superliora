/**
 * PlanBrowserOverlayComponent — a scrollable, read-only browser of the current
 * Plan-mode file, mounted as an editor replacement so it behaves like the
 * homepage demo's Plan overlay (P opens it, P / Esc close it).
 *
 * Reuses the same scrollable-panel chrome as the `/help` panel and renders the
 * plan Markdown through the shared renderer theme (headings, lists, code, …
 * colour the same way assistant messages and Plan boxes do). Long plans are
 * windowed to a bounded viewport and paged with ↑/↓/PgUp/PgDn/Home/End.
 */

import path from 'node:path';

import {
  Container,
  Key,
  Markdown,
  matchesKey,
  renderRendererScrollablePanelChromeRows,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import { printableChar } from '#/tui/utils/printable-key';

const DEFAULT_VIEWPORT_ROWS = 26;

export interface PlanBrowserOverlayOptions {
  /** Markdown plan content to browse. */
  readonly content: string;
  /** Absolute plan file path (used for the title), if known. */
  readonly path?: string;
  /** Close the browser and return focus to the free editor. */
  readonly onClose: () => void;
  /** Cap the number of body rows painted per frame. */
  readonly viewportRows?: number;
}

export class PlanBrowserOverlayComponent extends Container implements Focusable {
  focused = false;
  private readonly markdown: Markdown;
  private readonly onClose: () => void;
  private readonly viewportRows: number;
  private readonly planTitle: string;
  private scrollTop = 0;

  constructor(options: PlanBrowserOverlayOptions) {
    super();
    this.markdown = new Markdown(options.content.trim(), 0, 0, createMarkdownTheme());
    this.onClose = options.onClose;
    this.viewportRows = Math.max(5, options.viewportRows ?? DEFAULT_VIEWPORT_ROWS);
    const base = options.path === undefined ? undefined : path.basename(options.path);
    this.planTitle = base === undefined || base.length === 0 ? ' plan ' : ` plan · ${base} `;
  }

  handleInput(data: string): void {
    const printable = printableChar(data);
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      printable === 'q' ||
      printable === 'Q' ||
      printable === 'p' ||
      printable === 'P'
    ) {
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scrollTop = Math.max(0, this.scrollTop - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scrollTop += 1; // render clamps to the last page
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollTop = Math.max(0, this.scrollTop - this.viewportRows);
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollTop += this.viewportRows;
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.scrollTop = 0;
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.scrollTop = Number.MAX_SAFE_INTEGER; // render clamps
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const accent = (text: string) => currentTheme.fg('primary', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const muted = (text: string) => currentTheme.fg('textMuted', text);

    const contentWidth = Math.max(8, safeWidth - 4);
    const body = this.markdown.render(contentWidth);

    const projection = renderRendererScrollablePanelChromeRows({
      width: safeWidth,
      title: this.planTitle,
      hint: ' Esc / P closes · arrows scroll ',
      body,
      viewportRows: this.viewportRows,
      scrollTop: this.scrollTop,
      footerTopGap: false,
      dividerStyle: accent,
      titleStyle: (text) => accent(text.trim()),
      hintStyle: muted,
      bodyTopGap: false,
      scrollFooter: (window) =>
        window.hasOverflow
          ? ` showing ${String(window.lineFrom)}-${String(window.lineTo)} of ${String(window.contentRows)} · ${dim('Esc/P to close')}`
          : `${dim('End of plan')} · Esc/P to close`,
      scrollFooterStyle: muted,
    });
    this.scrollTop = projection.scrollTop;
    return [...projection.rows];
  }
}
