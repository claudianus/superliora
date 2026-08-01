import { truncateToWidth, type Component } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderPulseGlyph,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';

export type SwarmModeMarkerState = 'active' | 'inactive' | 'ended';

export class SwarmModeMarkerComponent implements Component {
  private readonly entranceStartedAtMs = appearanceAnimationNow();

  constructor(private readonly state: SwarmModeMarkerState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const active = this.state === 'active';
    const animated = active && shouldRenderAmbientEffects(appearance);
    const token = this.state === 'inactive' ? 'textDim' : 'success';
    const marker = animated
      ? renderPulseGlyph(['✦', '✧', '✺', '∙'], `swarm:marker:${this.state}`, STATUS_BULLET, token, appearance)
      : currentTheme.boldFg(token, STATUS_BULLET);
    const label = animated
      ? renderPremiumHeadline(swarmMarkerLabel(this.state), `swarm:label:${this.state}`, appearance)
      : currentTheme.boldFg(token, swarmMarkerLabel(this.state));
    const lines = ['', truncateToWidth(marker + label, safeWidth, '…')];
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'status',
      appearance,
    });
  }
}

function swarmMarkerLabel(state: SwarmModeMarkerState): string {
  switch (state) {
    case 'active':
      return 'Swarm activated';
    case 'inactive':
      return 'Swarm deactivated';
    case 'ended':
      return 'Swarm ended';
  }
}
