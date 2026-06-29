import { truncateToWidth, type Component } from '@earendil-works/pi-tui';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';

export type UltraSwarmModeMarkerState = 'active' | 'ended';

export class UltraSwarmModeMarkerComponent implements Component {
  constructor(
    private readonly state: UltraSwarmModeMarkerState,
    private readonly expertCount: number,
    private readonly taskDescription: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const token = this.state === 'ended' ? 'textDim' : 'success';
    const marker = currentTheme.boldFg(token, STATUS_BULLET);
    const label = currentTheme.boldFg(token, ultraSwarmMarkerLabel(this.state, this.expertCount));
    const taskLine = currentTheme.fg('textDim', truncateToWidth(`  ${this.taskDescription}`, safeWidth - 2, '…'));
    return ['', truncateToWidth(marker + label, safeWidth, '…'), taskLine];
  }
}

function ultraSwarmMarkerLabel(state: UltraSwarmModeMarkerState, expertCount: number): string {
  const expertLabel = expertCount > 0 ? ` (${expertCount} experts)` : '';
  switch (state) {
    case 'active':
      return `UltraSwarm activated${expertLabel}`;
    case 'ended':
      return `UltraSwarm ended${expertLabel}`;
  }
}
