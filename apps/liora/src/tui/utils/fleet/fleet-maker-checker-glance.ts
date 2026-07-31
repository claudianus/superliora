/**
 * Fleet Maker≠Checker runtime glance — TUI soft warn helpers (SSOT: swarm-maker-checker).
 */

import {
  detectMakerCheckerCollisionsFromAssignments,
  detectMakerCheckerCollisionsFromSwarmOutput,
  formatMakerCheckerSoftWarn,
  SWARM_MAKER_CHECKER_SOFT_TIP,
} from '@superliora/sdk';

import type { UltraSwarmMemberMetadata } from '#/tui/features/agent-swarm/agent-swarm-progress-types';
import type { UltraSwarmIntegrationReport } from '#/tui/features/agent-swarm/agent-swarm-result-parser';
import {
  FLEET_MAKER_CHECKER_SOFT_TIP,
  FLEET_MAKER_CHECKER_SOFT_TIP_KO,
  OPS_FLEET_MAKER_CHECKER_SOFT_TIP,
} from '#/tui/utils/fleet/fleet-glance';

export {
  FLEET_MAKER_CHECKER_SOFT_TIP,
  FLEET_MAKER_CHECKER_SOFT_TIP_KO,
  OPS_FLEET_MAKER_CHECKER_SOFT_TIP,
};

export function makerCheckerSoftWarnFromMembers(
  members: readonly { readonly ultraSwarm?: UltraSwarmMemberMetadata }[],
): string | undefined {
  const rows = members.flatMap((member) => {
    const meta = member.ultraSwarm;
    if (meta === undefined) return [];
    return [{
      expertId: meta.expertId,
      expertName: meta.name,
      focus: meta.focus,
      coverageLane: meta.coverageLane,
    }];
  });
  return formatMakerCheckerSoftWarn(detectMakerCheckerCollisionsFromAssignments(rows));
}

export function makerCheckerSoftWarnFromIntegrationReport(
  report: UltraSwarmIntegrationReport | undefined,
): string | undefined {
  if (report === undefined) return undefined;
  return formatMakerCheckerSoftWarn(
    detectMakerCheckerCollisionsFromAssignments(
      report.agents.map((agent) => ({
        expertId: agent.expertId,
        expertName: agent.name,
        phase: agent.phase,
      })),
    ),
  );
}

export function resolveMakerCheckerSoftWarn(input: {
  readonly output?: string;
  readonly members?: readonly { readonly ultraSwarm?: UltraSwarmMemberMetadata }[];
  readonly integrationReport?: UltraSwarmIntegrationReport;
}): string | undefined {
  if (input.output !== undefined) {
    const fromOutput = formatMakerCheckerSoftWarn(
      detectMakerCheckerCollisionsFromSwarmOutput(input.output),
    );
    if (fromOutput !== undefined) return fromOutput;
  }
  const fromReport = makerCheckerSoftWarnFromIntegrationReport(input.integrationReport);
  if (fromReport !== undefined) return fromReport;
  if (input.members !== undefined) {
    return makerCheckerSoftWarnFromMembers(input.members);
  }
  return undefined;
}

export function makerCheckerSoftWarnLine(warn: string | undefined): string | undefined {
  if (warn === undefined) return undefined;
  if (warn.includes(SWARM_MAKER_CHECKER_SOFT_TIP)) return warn;
  return `${SWARM_MAKER_CHECKER_SOFT_TIP} ${warn}`;
}
