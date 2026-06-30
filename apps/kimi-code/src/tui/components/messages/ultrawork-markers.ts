import { truncateToWidth, type Component } from '@earendil-works/pi-tui';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';

export type UltraworkModeMarkerState = 'active' | 'ended';

const ULTRAWORK_PIPELINE = 'UltraPlan -> UltraGoal -> UltraSwarm -> Verify';
const ULTRAWORK_STAGE_STATUS = 'UltraPlan active | UltraGoal created | UltraSwarm armed | Verify queued';

export class UltraworkModeMarkerComponent implements Component {
  constructor(
    private readonly state: UltraworkModeMarkerState,
    private readonly taskDescription: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const token = this.state === 'ended' ? 'textDim' : 'success';
    const marker = currentTheme.boldFg(token, STATUS_BULLET);
    const label = currentTheme.boldFg(token, ultraworkMarkerLabel(this.state));
    const pipelineToken = this.state === 'ended' ? 'textDim' : 'primary';
    const pipelineLine = currentTheme.fg(
      pipelineToken,
      truncateToWidth(`  ${ULTRAWORK_PIPELINE}`, safeWidth, '…'),
    );
    const stageStatusToken = this.state === 'ended' ? 'textDim' : 'text';
    const stageStatusLine = currentTheme.fg(
      stageStatusToken,
      truncateToWidth(`  ${ULTRAWORK_STAGE_STATUS}`, safeWidth, '…'),
    );
    const taskLine = currentTheme.fg('textDim', truncateToWidth(`  ${this.taskDescription}`, safeWidth, '…'));
    return ['', truncateToWidth(marker + label, safeWidth, '…'), pipelineLine, stageStatusLine, taskLine];
  }
}

function ultraworkMarkerLabel(state: UltraworkModeMarkerState): string {
  switch (state) {
    case 'active':
      return 'Ultrawork activated';
    case 'ended':
      return 'Ultrawork ended';
  }
}
