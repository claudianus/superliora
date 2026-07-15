/**
 * Pure UltraSwarm expert prompt assembly.
 */

import type { TeamPlan, WorkGraphNode } from '@superliora/protocol';

import { buildCriticAssignmentXml } from '../../../session/ultra-swarm-critic';
import {
  buildSwarmChannelRulesXml,
  buildSwarmCollaborationRequiredXml,
  buildTeamRosterXml,
} from '../../../session/swarm-bus-coordination';
import { buildExpertSwarmExecutionFooter } from '../../../expert-agents/expert-persona';
import { appendSwarmResearchAutonomy } from './swarm-research-autonomy';
import { formatWorkNodeContract } from './ultra-swarm-helpers';
import type { UltraSwarmPhase, UltraSwarmSpec } from './ultra-swarm-phase';

export function buildUltraSwarmExpertPrompt(input: {
  readonly spec: UltraSwarmSpec;
  readonly taskDescription: string;
  readonly workNodes: readonly WorkGraphNode[];
  readonly phaseHandoff: string;
  readonly team: TeamPlan;
  readonly busEnabled: boolean;
  readonly dependencyHandoff?: string;
  readonly phase?: UltraSwarmPhase;
  readonly liveBusDigest?: string;
}): string {
  const spec = input.spec;
  const phase = input.phase ?? spec.phase;
  const dependencyHandoff = input.dependencyHandoff ?? '';
  const liveBusDigest = input.liveBusDigest ?? '';

  const briefing = `<expert_briefing name="${spec.expertName}" emoji="${spec.emoji}" color="${spec.color}" phase="${spec.phase}">
${spec.assignmentPrompt}
</expert_briefing>`;
  const task = `<task>
${input.taskDescription}
</task>`;
  const laneLine = spec.coverageLane === undefined ? '' : `\nCoverage lane: ${spec.coverageLane}.`;
  const reasonLine =
    spec.selectionReason === undefined ? '' : `\nSelection reason: ${spec.selectionReason}`;
  const focusLine = `\nFocus lane: ${spec.focus}.`;
  const phaseLine = `\nUltraSwarm phase: ${spec.phase}.`;
  const handoffLine =
    input.phaseHandoff.length === 0
      ? ''
      : `\n\n<previous_phase_handoff>\n${input.phaseHandoff}\n</previous_phase_handoff>`;
  const dependencyLine = dependencyHandoff.length === 0 ? '' : `\n\n${dependencyHandoff}`;
  const reviewLine =
    spec.phase === 'review' || spec.focus === 'review' || spec.focus === 'full'
      ? '\nReview gate: start your final answer with one of "VERDICT: PASS", "VERDICT: BLOCKED", or "VERDICT: FAIL". Return PASS only when evidence is sufficient; otherwise return concrete fixes and the evidence still missing.'
      : '';
  const workNodeLine =
    input.workNodes.length === 0 ? '' : `\n\n${formatWorkNodeContract(input.workNodes)}`;
  const liveBusLine = liveBusDigest.length > 0 ? `\n\n${liveBusDigest}` : '';
  const collaborationLine = input.busEnabled
    ? `\n\n${buildTeamRosterXml(input.team)}\n\n${buildSwarmChannelRulesXml()}\n\n${buildSwarmCollaborationRequiredXml(phase)}${liveBusLine}`
    : '';
  const criticLine =
    spec.criticAssignment === undefined
      ? ''
      : `\n\n${buildCriticAssignmentXml(spec.criticAssignment)}`;
  return appendSwarmResearchAutonomy(
    `${briefing}\n\n${task}${laneLine}${reasonLine}${focusLine}${phaseLine}${reviewLine}${workNodeLine}${collaborationLine}${handoffLine}${dependencyLine}${criticLine}\n\n${buildExpertSwarmExecutionFooter(spec.expertName)}`,
  );
}
