import { truncateToWidth, type Component } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderPulseGlyph,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export type SwarmModeMarkerState = 'active' | 'inactive' | 'ended';

export class SwarmModeMarkerComponent implements Component {
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
    return ['', truncateToWidth(marker + label, safeWidth, '…')];
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
