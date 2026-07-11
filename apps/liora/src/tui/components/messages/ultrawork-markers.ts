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

export interface UltraworkModeMarkerOptions {
  readonly state: UltraworkModeMarkerState;
  readonly taskDescription: string;
  readonly currentStage?: string;
  readonly progress?: string;
}

const ULTRAWORK_PIPELINE = 'Research -> UltraPlan -> UltraGoal -> Swarm decision -> Integrate -> Verify -> Learn';
const ULTRAWORK_COMPACT_PIPELINE = 'Research>UltraPlan>UltraGoal>Swarm?>Integrate>Verify>Learn';
const ULTRAWORK_STAGE_STATUS = 'One Ultrawork: source-backed questions, verifiable goal, decide team, verify';
const ULTRAWORK_RESEARCH_STATUS = 'Research: local fallback + provider/MCP accelerators; verified sources only';
const ULTRAWORK_NEXT_ACTION = 'Next: research evidence pack before UltraPlan questions';
const ULTRAWORK_COMPLETION_STATUS =
  'Goal complete — Research, UltraPlan, Swarm, Integrate, Verify, and Learn finished.';
const ULTRAWORK_COMPLETION_NEXT = 'Ultrawork mode is off. Continue with normal prompts or Shift-Tab for a new run.';

export class UltraworkModeMarkerComponent implements Component {
  constructor(
    private readonly options: UltraworkModeMarkerOptions,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const active = this.options.state === 'active';
    const animated = active && shouldRenderAmbientEffects(appearance);
    const token = active ? 'success' : 'textDim';
    const marker = animated
      ? renderPulseGlyph(['✦', '✧', '✺', '∙'], `ultrawork:marker:${this.options.state}`, STATUS_BULLET, token, appearance)
      : currentTheme.boldFg(token, STATUS_BULLET);
    const label = animated
      ? renderPremiumHeadline(ultraworkMarkerLabel(this.options.state), `ultrawork:label:${this.options.state}`, appearance)
      : currentTheme.boldFg(token, ultraworkMarkerLabel(this.options.state));
    const pipelineText =
      `  ${ULTRAWORK_PIPELINE}`.length <= safeWidth
        ? `  ${ULTRAWORK_PIPELINE}`
        : `  ${ULTRAWORK_COMPACT_PIPELINE}`;
    const pipelineLine = animated
      ? renderPremiumAccentLine(pipelineText, 'ultrawork:pipeline', appearance)
      : currentTheme.fg(active ? 'primary' : 'textDim', truncateToWidth(pipelineText, safeWidth, '…'));
    const stageStatusToken = active ? 'text' : 'textDim';
    const stageStatusLine = active
      ? currentTheme.fg(
          stageStatusToken,
          truncateToWidth(`  ${ULTRAWORK_STAGE_STATUS}`, safeWidth, '…'),
        )
      : currentTheme.fg(
          stageStatusToken,
          truncateToWidth(`  ${ULTRAWORK_COMPLETION_STATUS}`, safeWidth, '…'),
        );
    const nextActionLine = currentTheme.fg(
      stageStatusToken,
      truncateToWidth(
        `  ${active ? ULTRAWORK_NEXT_ACTION : ULTRAWORK_COMPLETION_NEXT}`,
        safeWidth,
        '…',
      ),
    );
    const researchLine = active
      ? currentTheme.fg(
          stageStatusToken,
          truncateToWidth(`  ${ULTRAWORK_RESEARCH_STATUS}`, safeWidth, '…'),
        )
      : undefined;
    const taskLine = currentTheme.fg('textDim', truncateToWidth(`  ${this.options.taskDescription}`, safeWidth, '…'));
    
    // Add stage and progress information if available
    const extraInfo: string[] = [];
    if (this.options.currentStage !== undefined) {
      extraInfo.push(currentTheme.fg('primary', truncateToWidth(`  Stage: ${this.options.currentStage}`, safeWidth, '…')));
    }
    if (this.options.progress !== undefined) {
      extraInfo.push(currentTheme.fg('textDim', truncateToWidth(`  ${this.options.progress}`, safeWidth, '…')));
    }

    return [
      '',
      truncateToWidth(marker + label, safeWidth, '…'),
      truncateToWidth(pipelineLine, safeWidth, '…'),
      stageStatusLine,
      ...(researchLine !== undefined ? [researchLine] : []),
      nextActionLine,
      ...extraInfo,
      taskLine,
    ];
  }
}

function ultraworkMarkerLabel(state: UltraworkModeMarkerState): string {
  switch (state) {
    case 'active':
      return 'Ultrawork activated';
    case 'ended':
      return 'Ultrawork completed';
  }
}
