import type { Component, MarkdownTheme } from '#/tui/renderer';
import {
  Markdown,
  RendererStableScrollableLineViewport,
  Text,
  fitRendererFrameTitle,
  projectRendererLineWindow,
  renderRendererStableScrollableFrameRows,
} from '#/tui/renderer';
import chalk from 'chalk';

import { THINKING_PREVIEW_LINES } from '../../constant/rendering';
import { currentTheme } from '../../theme';
import {
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '../../utils/appearance-effects';

type BtwPanelPhase = 'running' | 'done' | 'failed';

const MIN_COLLAPSED_PANEL_LINES = 3;

interface BtwTurn {
  readonly prompt: string;
  answer: string;
  thinking: string;
  error?: string | undefined;
  phase: BtwPanelPhase;
}

export interface BtwPanelOptions {
  readonly markdownTheme: MarkdownTheme;
  readonly canUseScrollKeys: () => boolean;
  readonly onPrompt: (prompt: string) => void;
  readonly terminalRows: () => number;
}

export class BtwPanelComponent implements Component {
  private readonly turns: BtwTurn[] = [];
  private readonly transientNotices: string[] = [];
  private readonly bodyViewport = new RendererStableScrollableLineViewport();

  constructor(private readonly options: BtwPanelOptions) {}

  submit(prompt: string): void {
    const normalized = prompt.trim();
    if (normalized.length === 0 || this.isRunning()) return;
    this.bodyViewport.toBottom();
    this.transientNotices.length = 0;
    this.turns.push({
      prompt: normalized,
      answer: '',
      thinking: '',
      phase: 'running',
    });
    this.options.onPrompt(normalized);
  }

  addTransientNotice(message: string): void {
    this.transientNotices.push(message);
    this.bodyViewport.toBottom();
  }

  appendAnswer(delta: string): void {
    const turn = this.currentTurn();
    if (turn === undefined) return;
    turn.answer += delta;
  }

  appendThinking(delta: string): void {
    const turn = this.currentTurn();
    if (turn === undefined) return;
    turn.thinking += delta;
  }

  markDone(resultSummary?: string | undefined): void {
    const turn = this.currentTurn();
    if (turn === undefined) return;
    if (turn.answer.trim().length === 0 && resultSummary !== undefined) {
      turn.answer = resultSummary;
    }
    this.transientNotices.length = 0;
    turn.phase = 'done';
  }

  markFailed(error: string): void {
    const turn = this.currentTurn();
    if (turn === undefined || turn.phase !== 'running') {
      this.turns.push({
        prompt: '',
        answer: '',
        thinking: '',
        error,
        phase: 'failed',
      });
      this.transientNotices.length = 0;
      return;
    }
    turn.error = error;
    this.transientNotices.length = 0;
    turn.phase = 'failed';
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(4, width);
    const contentWidth = Math.max(1, safeWidth - 4);
    const body = this.renderBody(contentWidth);
    const paint = (s: string): string => chalk.hex(currentTheme.palette.border)(s);
    return [...renderRendererStableScrollableFrameRows({
      viewport: this.bodyViewport,
      body,
      maxViewportRows: this.collapsedBodyLimit(),
      fill: '',
      title: ({ hasOverflow, titleWidth }) =>
        this.renderTitle(titleWidth, hasOverflow),
      titlePlacement: 'flush',
      borderKind: 'rounded',
      bottomBorder: false,
      width: safeWidth,
      paddingX: 1,
      borderStyle: paint,
      ellipsis: '…',
    }).rows];
  }

  private renderTitle(width: number, truncated: boolean): string {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const paint = (s: string): string => chalk.hex(currentTheme.palette.border)(s);
    const hint = truncated && this.options.canUseScrollKeys()
      ? 'Esc close · ↑↓ scroll · /btw '
      : 'Esc close · /btw ';
    const titleLabel = animated
      ? renderPremiumHeadline('BTW', 'btw:title', appearance)
      : chalk.hex(currentTheme.palette.accent).bold(' BTW ');
    const title =
      titleLabel +
      paint('─ ') +
      chalk.hex(currentTheme.palette.textMuted)(hint);
    return fitRendererFrameTitle(title, width, '');
  }

  private renderBody(width: number): string[] {
    const lines: string[] = [];
    for (const [index, turn] of this.turns.entries()) {
      if (index > 0) lines.push('');
      lines.push(...this.renderTurn(turn, width));
    }
    if (this.turns.length === 0) {
      lines.push(chalk.hex(currentTheme.palette.textDim)('Ready for a side question...'));
    }
    lines.push(...this.renderTransientNotices(width));
    return lines;
  }

  private renderTransientNotices(width: number): string[] {
    const lines: string[] = [];
    for (const notice of this.transientNotices) {
      lines.push(...new Text(chalk.hex(currentTheme.palette.textDim)(notice), 0, 0).render(width));
    }
    return lines;
  }

  private collapsedBodyLimit(): number | undefined {
    const terminalRows = this.options.terminalRows();
    if (!Number.isFinite(terminalRows) || terminalRows <= 0) return undefined;
    const maxPanelLines = Math.max(MIN_COLLAPSED_PANEL_LINES, Math.floor(terminalRows / 3));
    return Math.max(1, maxPanelLines - 1);
  }

  private renderTurn(turn: BtwTurn, width: number): string[] {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const promptText = animated
      ? renderSpectacularText(`Q: ${turn.prompt}`, `btw:prompt:${turn.prompt}`, appearance, {
          intense: true,
        })
      : chalk.hex(currentTheme.palette.accent)(`Q: ${turn.prompt}`);
    const prompt = promptText;
    const lines = [...new Text(prompt, 0, 0).render(width)];
    const answer = turn.answer.trim();
    const thinking = turn.thinking.trim();
    if (answer.length > 0) {
      lines.push(...new Markdown(answer, 0, 0, this.options.markdownTheme).render(width));
    } else if (thinking.length > 0) {
      const thinkingLines = new Text(chalk.hex(currentTheme.palette.textDim)(thinking), 0, 0).render(
        width,
      );
      const visibleThinking = projectRendererLineWindow({
        lines: thinkingLines,
        maxLines: THINKING_PREVIEW_LINES,
        tail: true,
      }).lines;
      lines.push(...visibleThinking);
    } else if (turn.error === undefined) {
      lines.push(chalk.hex(currentTheme.palette.textDim)('Waiting for answer...'));
    }
    if (turn.error !== undefined) {
      const error = chalk.hex(currentTheme.palette.error)(turn.error);
      lines.push(...new Text(error, 0, 0).render(width));
    }
    return lines;
  }

  private currentTurn(): BtwTurn | undefined {
    return this.turns.at(-1);
  }

  isRunning(): boolean {
    return this.currentTurn()?.phase === 'running';
  }

  isEmpty(): boolean {
    return this.turns.length === 0;
  }

  scroll(direction: 'up' | 'down'): boolean {
    const before = this.bodyViewport.snapshot();
    if (before.maxScrollTop <= 0) return false;
    const after = this.bodyViewport.scroll(
      direction === 'up' ? 'line-up' : 'line-down',
    );
    return after.scrollTop !== before.scrollTop ||
      after.followTail !== before.followTail;
  }
}
