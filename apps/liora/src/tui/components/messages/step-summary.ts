import type { Component } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

/**
 * A collapsed summary of older steps within a turn. Accumulates counts of
 * merged steps (thinking blocks and tool calls) and renders them as a single
 * dense, demo-grade line, e.g. `… ░░▒▓ thinking×5 · tools×50`.
 */
const SPARK = ['░', '▒', '▓', '█'] as const;

export class StepSummaryComponent implements Component {
  private thinking = 0;
  private tool = 0;

  get isEmpty(): boolean {
    return this.thinking === 0 && this.tool === 0;
  }

  addCounts(thinking: number, tool: number): void {
    this.thinking += thinking;
    this.tool += tool;
  }

  invalidate(): void {}

  render(_width: number): string[] {
    const parts: string[] = [];
    if (this.thinking > 0) parts.push(`thinking×${String(this.thinking)}`);
    if (this.tool > 0) parts.push(`tools×${String(this.tool)}`);
    if (parts.length === 0) return [];

    const appearance = getActiveAppearancePreferences();
    const spark = buildSparkBar(this.thinking + this.tool, appearance);
    const body = currentTheme.dim(`\u2026 ${spark}${parts.join(' · ')}`);
    return [body];
  }
}

function buildSparkBar(total: number, appearance: ReturnType<typeof getActiveAppearancePreferences>): string {
  if (total <= 0) return '';
  const animated = shouldRenderAmbientEffects(appearance);
  const phase = animated ? Math.floor(appearanceAnimationNow() / 400) % SPARK.length : 0;
  const intensity = Math.min(3, Math.max(0, Math.floor(Math.log2(total + 1))));
  const cells = Array.from({ length: 6 }, (_, i) => {
    const level = Math.max(0, intensity - (5 - i));
    const glyph = SPARK[Math.min(SPARK.length - 1, (level + phase) % SPARK.length)] ?? '░';
    return i <= intensity + 1 ? glyph : '░';
  });
  return `${cells.join('')} `;
}
