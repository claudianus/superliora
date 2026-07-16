import type { Component } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

/**
 * Collapsed summary of older steps within a turn.
 * Dense demo-grade line: `… ░░▒▓█ thinking×5 · tools×50 · n=55`.
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

    const total = this.thinking + this.tool;
    const appearance = getActiveAppearancePreferences();
    const spark = buildSparkBar(total, appearance);
    // total count keeps long-turn collapse glanceable without expanding cards
    parts.push(`n=${String(total)}`);
    const body = currentTheme.dim(`… ${spark}${parts.join(' · ')}`);
    return [body];
  }
}

export function buildSparkBar(
  total: number,
  appearance: ReturnType<typeof getActiveAppearancePreferences>,
): string {
  if (total <= 0) return '';
  const animated = shouldRenderAmbientEffects(appearance);
  const phase = animated ? Math.floor(appearanceAnimationNow() / 280) % SPARK.length : 0;
  // log2 intensity: 1→0, 2→1, 4→2, 8→3 — denser 8-cell bar for demo-grade collapse.
  const intensity = Math.min(3, Math.max(0, Math.floor(Math.log2(total + 1))));
  const width = 8;
  const cells = Array.from({ length: width }, (_, i) => {
    const level = Math.max(0, intensity - (width - 1 - i));
    const glyph = SPARK[Math.min(SPARK.length - 1, (level + phase) % SPARK.length)] ?? '░';
    return i <= intensity + 2 ? glyph : '░';
  });
  return `${cells.join('')} `;
}
