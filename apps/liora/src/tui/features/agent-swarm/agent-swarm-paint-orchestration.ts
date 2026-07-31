import chalk from 'chalk';

import type { ResponsiveLayoutProfile } from '#/tui/controllers/layout/responsive-layout';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import {
  SWARM_OPS_FEED_RENDER_LINES,
  SWARM_OPS_FEED_RENDER_LINES_TINY,
} from '#/tui/features/agent-swarm/agent-swarm-progress-constants';
import type { ColorPalette } from '#/tui/theme/colors';

export interface UltraSwarmWarRoomPanelSections {
  readonly missionContent: readonly string[];
  readonly teamContent: readonly string[];
  readonly activityContent: readonly string[];
  readonly reportContent: readonly string[];
  readonly governanceContent: readonly string[];
  readonly debateContent: readonly string[];
  readonly evidenceContent: readonly string[];
  readonly fileMapContent: readonly string[];
  readonly feedContent: readonly string[];
  readonly toolFeedContent: readonly string[];
  readonly actionDock: readonly string[];
  readonly statusFooter: readonly string[];
}

export function ultraSwarmFeedRenderLineLimit(profile: ResponsiveLayoutProfile): number {
  return profile === 'tiny' ? SWARM_OPS_FEED_RENDER_LINES_TINY : SWARM_OPS_FEED_RENDER_LINES;
}

export function renderUltraSwarmWarRoomPanel(
  width: number,
  profile: ResponsiveLayoutProfile,
  colors: ColorPalette,
  sections: UltraSwarmWarRoomPanelSections,
): string[] {
  const teamBody = sections.teamContent.length > 0
    ? sections.teamContent
    : [chalk.hex(colors.textDim)('awaiting agents…')];
  const feedHeader = chalk.hex(colors.textDim)('war room · team feed');
  const panelContent = [
    ...sections.missionContent,
    '',
    ...teamBody,
    ...(sections.activityContent.length > 0 ? ['', ...sections.activityContent] : []),
    ...(sections.reportContent.length > 0 ? ['', ...sections.reportContent] : []),
    ...(sections.governanceContent.length > 0 ? ['', ...sections.governanceContent] : []),
    ...(sections.debateContent.length > 0 ? ['', ...sections.debateContent] : []),
    ...(sections.evidenceContent.length > 0 ? ['', ...sections.evidenceContent] : []),
    ...(sections.fileMapContent.length > 0 ? ['', ...sections.fileMapContent] : []),
    '',
    feedHeader,
    ...sections.feedContent,
    ...sections.toolFeedContent,
    ...(sections.actionDock.length > 0 ? ['', ...sections.actionDock] : []),
  ];

  if (profile === 'tiny') {
    return ['', ...panelContent, ...sections.statusFooter];
  }

  return [
    '',
    ...renderRoundedPanel({
      title: ' Fleet ',
      content: panelContent,
      width,
      borderToken: 'primary',
      minBoxWidth: 60,
    }),
    ...sections.statusFooter,
  ];
}
