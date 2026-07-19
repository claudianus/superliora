/**
 * PlanBoxComponent — renders an ExitPlanMode plan inside a full box
 * border, width-aware. The plan text is parsed as Markdown so headings,
 * lists, bold, inline code etc. render the same way assistant messages do.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  Markdown,
  fitRendererFrameTitle,
  renderRendererFrameRows,
  truncateToWidth,
  visibleWidth,
  type Component,
  type MarkdownTheme,
} from '#/tui/renderer';
import chalk from 'chalk';

import {
  getActiveAppearancePreferences,
  renderParticleRail,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

import { toTerminalHyperlink } from '#/utils/terminal-hyperlink';

const LEFT_MARGIN = 2; // two-space indent matching other tool call children
const SIDE_PADDING = 1; // space between the │ and the content on each side
const TITLE_PREFIX = ' plan: ';
const TITLE_SUFFIX = ' ';

export interface PlanBoxOptions {
  status?: {
    readonly label: string;
    readonly colorHex: string;
  };
}

export class PlanBoxComponent implements Component {
  private readonly markdown: Markdown;
  private readonly status: PlanBoxOptions['status'];
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    plan: string,
    markdownTheme: MarkdownTheme,
    private readonly borderHex: string,
    private readonly planPath?: string,
    opts?: PlanBoxOptions,
  ) {
    // Build the Markdown instance once — renderer Markdown caches its own
    // parse + wrap output keyed on (text, width), so reusing the same
    // instance means repeated render() calls from the parent Container
    // hit the cache instead of re-parsing on every frame.
    this.markdown = new Markdown(plan.trim(), 0, 0, markdownTheme);
    this.status = opts?.status;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.markdown.invalidate?.();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    if (safeWidth < LEFT_MARGIN + 4) {
      return this.markdown.render(Math.max(1, safeWidth)).map((line) => truncateToWidth(line, safeWidth, '…'));
    }

    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    // Particle rails animate from the shared clock — skip the static cache when ambient.
    if (!animated && this.cachedLines !== undefined && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const horzLen = Math.max(2, safeWidth - LEFT_MARGIN - 2);
    const contentWidth = Math.max(1, horzLen - 2 * SIDE_PADDING);

    const paint = (s: string): string => chalk.hex(this.borderHex)(s);
    const indent = ' '.repeat(LEFT_MARGIN);
    const title = this.buildTitle(horzLen);
    const rawLines = this.markdown.render(contentWidth);
    const frame = renderRendererFrameRows({
      title,
      titlePlacement: 'flush',
      content: rawLines,
      width: safeWidth - LEFT_MARGIN,
      height: rawLines.length + 2,
      paddingX: SIDE_PADDING,
      borderStyle: paint,
      titleStyle: paint,
      ellipsis: '…',
    });
    const lines = frame.map((line) => indent + line);

    const fitted = lines.map((line) => truncateToWidth(line, safeWidth, '…'));
    if (animated && safeWidth >= 28) {
      const rail = renderParticleRail(safeWidth, appearance, 'plan');
      return ['', rail, ...fitted, rail];
    }
    this.cachedWidth = width;
    this.cachedLines = fitted;
    return fitted;
  }

  private buildTitle(horzLen: number): string {
    const fallback = ' plan ';
    const statusSuffix = this.buildStatusSuffix();
    const fallbackWithStatus = ` plan${statusSuffix} `;
    const budget = Math.max(0, horzLen - 1);
    const fallbackTitle = fitRendererFrameTitle(
      visibleWidth(fallbackWithStatus) <= budget ? fallbackWithStatus : fallback,
      budget,
      '…',
    );
    const planPath = this.planPath;
    if (planPath === undefined || planPath.length === 0) return fallbackTitle;
    const basename = path.basename(planPath);
    if (basename.length === 0) return fallbackTitle;
    const linked = path.isAbsolute(planPath)
      ? toTerminalHyperlink(basename, pathToFileURL(planPath).href)
      : basename;
    const title = TITLE_PREFIX + linked + statusSuffix + TITLE_SUFFIX;
    if (visibleWidth(title) > budget) return fallbackTitle;
    return title;
  }

  private buildStatusSuffix(): string {
    const status = this.status;
    if (status === undefined || status.label.length === 0) return '';
    return ` · ${chalk.hex(status.colorHex)(status.label)}`;
  }
}
