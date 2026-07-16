import {Container, Spacer} from '#/tui/renderer';

import type { MoonLoader } from '#/tui/components/chrome/moon-loader';
import {currentTheme} from '#/tui/theme';
import {getActiveAppearancePreferences, renderParticleRail, shouldRenderAmbientEffects} from '#/tui/utils/appearance-effects';

export type ActivityPaneMode = 'hidden' | 'waiting' | 'thinking' | 'composing' | 'tool';

export interface ActivityPaneOptions {
  readonly mode: ActivityPaneMode;
  readonly spinner?: MoonLoader;
  readonly tip?: string;
}

export class ActivityPaneComponent extends Container {
  private spinnerRef?: MoonLoader;
  private readonly mode: ActivityPaneMode;

  constructor(options: ActivityPaneOptions) {
    super();
    this.spinnerRef = options.spinner;
    this.mode = options.mode;

    if (
      (options.mode === 'waiting' || options.mode === 'tool' || options.mode === 'composing') &&
      options.spinner !== undefined
    ) {
      this.addChild(new Spacer(1));
      if (options.tip) {
        options.spinner.setTip(` · Tip: ${options.tip}`);
      }
      this.addChild(options.spinner);
    }
  }

  override render(width: number): string[] {
    if (this.spinnerRef && 'setAvailableWidth' in this.spinnerRef) {
      this.spinnerRef.setAvailableWidth(width);
    }
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance) || width < 24) return lines;

    // Dual particle rails: live activity stays visually dense during long waits.
    if (this.mode === 'waiting' || this.mode === 'composing' || this.mode === 'tool') {
      const railA = renderParticleRail(width, appearance, `activity:${this.mode}:a`);
      const railB = renderParticleRail(width, appearance, `activity:${this.mode}:b`);
      return [...lines, currentTheme.dim(railA), currentTheme.dim(railB)];
    }
    return lines;
  }
}
