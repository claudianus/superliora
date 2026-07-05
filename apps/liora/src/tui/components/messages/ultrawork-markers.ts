import { truncateToWidth, type Component } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';
import {
  getActiveAppearancePreferences,
  renderPremiumAccentLine,
  renderPremiumHeadline,
  renderPulseGlyph,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export type UltraworkModeMarkerState = 'active' | 'ended';

const ULTRAWORK_PIPELINE = 'Research -> UltraPlan -> UltraGoal -> Swarm decision -> Integrate -> Verify -> Learn';
const ULTRAWORK_COMPACT_PIPELINE = 'Research>UltraPlan>UltraGoal>Swarm?>Integrate>Verify>Learn';
const ULTRAWORK_STAGE_STATUS = 'One Ultrawork: source-backed questions, verifiable goal, decide team, verify';
const ULTRAWORK_RESEARCH_STATUS = 'Research: local fallback + provider/MCP accelerators; verified sources only';
const ULTRAWORK_NEXT_ACTION = 'Next: research evidence pack before UltraPlan questions';

export class UltraworkModeMarkerComponent implements Component {
  constructor(
    private readonly state: UltraworkModeMarkerState,
    private readonly taskDescription: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const active = this.state === 'active';
    const animated = active && shouldRenderAmbientEffects(appearance);
    const token = active ? 'success' : 'textDim';
    const marker = animated
      ? renderPulseGlyph(['✦', '✧', '✺', '∙'], `ultrawork:marker:${this.state}`, STATUS_BULLET, token, appearance)
      : currentTheme.boldFg(token, STATUS_BULLET);
    const label = animated
      ? renderPremiumHeadline(ultraworkMarkerLabel(this.state), `ultrawork:label:${this.state}`, appearance)
      : currentTheme.boldFg(token, ultraworkMarkerLabel(this.state));
    const pipelineText =
      `  ${ULTRAWORK_PIPELINE}`.length <= safeWidth
        ? `  ${ULTRAWORK_PIPELINE}`
        : `  ${ULTRAWORK_COMPACT_PIPELINE}`;
    const pipelineLine = animated
      ? renderPremiumAccentLine(pipelineText, 'ultrawork:pipeline', appearance)
      : currentTheme.fg(active ? 'primary' : 'textDim', truncateToWidth(pipelineText, safeWidth, '…'));
    const stageStatusToken = active ? 'text' : 'textDim';
    const stageStatusLine = currentTheme.fg(
      stageStatusToken,
      truncateToWidth(`  ${ULTRAWORK_STAGE_STATUS}`, safeWidth, '…'),
    );
    const nextActionLine = currentTheme.fg(
      stageStatusToken,
      truncateToWidth(`  ${ULTRAWORK_NEXT_ACTION}`, safeWidth, '…'),
    );
    const researchLine = currentTheme.fg(
      stageStatusToken,
      truncateToWidth(`  ${ULTRAWORK_RESEARCH_STATUS}`, safeWidth, '…'),
    );
    const taskLine = currentTheme.fg('textDim', truncateToWidth(`  ${this.taskDescription}`, safeWidth, '…'));
    return [
      '',
      truncateToWidth(marker + label, safeWidth, '…'),
      truncateToWidth(pipelineLine, safeWidth, '…'),
      stageStatusLine,
      researchLine,
      nextActionLine,
      taskLine,
    ];
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
