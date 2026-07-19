/**
 * Build a full-height preview of the post-splash TUI (Welcome + Jewel Tank)
 * for the iris handoff composite.
 */

import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import type { AppState } from '#/tui/types';
import { padOrTrim } from '#/tui/utils/night-sky';

export function buildSplashRevealPreview(options: {
  readonly width: number;
  readonly rows: number;
  readonly appState: AppState;
}): string[] {
  const width = Math.max(1, Math.trunc(options.width));
  const rows = Math.max(1, Math.trunc(options.rows));
  const welcome = new WelcomeComponent(options.appState).render(width);
  const used = welcome.length;
  const idleBudget = Math.max(0, rows - used);
  const idle =
    idleBudget > 0
      ? new IdleStageComponent({
          state: options.appState,
          preferredRows: idleBudget,
        }).render(width)
      : [];

  const merged = [...welcome, ...idle];
  while (merged.length < rows) {
    merged.push(' '.repeat(width));
  }
  return merged.slice(0, rows).map((line) => padOrTrim(line, width));
}
