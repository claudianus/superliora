import { Container, Spacer, truncateToWidth, visibleWidth } from '#/tui/renderer';

import type { MoonLoader } from '#/tui/components/chrome/moon-loader';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderAmbientDrift,
  renderParticleRail,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  buildTurnStatusParts,
  composeTurnStatusLine,
  type TurnStatusInput,
} from '#/tui/features/transcript/turn-status';

export type ActivityPaneMode = 'hidden' | 'waiting' | 'thinking' | 'composing' | 'tool';

export interface ActivityPaneOptions {
  readonly mode: ActivityPaneMode;
  readonly spinner?: MoonLoader;
  readonly tip?: string;
  /** Live turn-status snapshot. Resolved at paint so elapsed/tokens stay fresh. */
  readonly resolveStatus?: () => TurnStatusInput | undefined;
}

export class ActivityPaneComponent extends Container {
  private spinnerRef?: MoonLoader;
  private readonly mode: ActivityPaneMode;
  private readonly resolveStatus?: () => TurnStatusInput | undefined;

  constructor(options: ActivityPaneOptions) {
    super();
    this.spinnerRef = options.spinner;
    this.mode = options.mode;
    this.resolveStatus = options.resolveStatus;

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
    const statusLine = this.renderTurnStatusLine(width);
    const lines = statusLine !== undefined ? [statusLine] : super.render(width);
    const appearance = getActiveAppearancePreferences();

    if (this.mode === 'thinking') {
      const drift = renderAmbientDrift(width, 'activity:thinking', appearance);
      return lines.length > 0 ? [...lines, currentTheme.dim(drift)] : [currentTheme.dim(drift)];
    }

    if (lines.length === 0) return lines;
    if (!shouldRenderAmbientEffects(appearance) || width < 24) return lines;

    // Single particle rail: premium motion without dual-rail vertical thrash.
    if (this.mode === 'waiting' || this.mode === 'composing' || this.mode === 'tool') {
      const rail = renderParticleRail(width, appearance, `activity:${this.mode}`);
      return [...lines, currentTheme.dim(rail)];
    }
    return lines;
  }

  private renderTurnStatusLine(width: number): string | undefined {
    const resolve = this.resolveStatus;
    if (resolve === undefined) return undefined;
    const snapshot = resolve();
    if (snapshot === undefined) return undefined;
    const parts = buildTurnStatusParts({
      ...snapshot,
      now: Date.now(),
    });
    const glyph = this.spinnerRef?.renderGlyph() ?? '';
    const label = currentTheme.fg('text', parts.label);
    const right = currentTheme.fg('textDim', parts.right);
    return composeTurnStatusLine({
      width,
      glyph,
      label,
      right,
      visibleWidth,
      pad: (text, budget) => truncateToWidth(text, budget),
    });
  }
}
