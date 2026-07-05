import { randomUUID } from 'node:crypto';

import type { SwarmBusMessage, TeamPlan } from '@superliora/protocol';

import type { Agent } from '../agent';
import type { Session } from './index';
import type { ToolStore } from '../tools/store';
import { postSwarmBusMessage } from '../tools/builtin/state/swarm-bus';

const SWARM_MENTION_REMINDER_NAME = 'swarm-bus-mention';
const SWARM_BLOCKER_REMINDER_NAME = 'swarm-bus-blocker';
const SWARM_PERIODIC_STANDUP_REMINDER_NAME = 'swarm-bus-periodic-standup';

export const SWARM_STANDUP_INTERVAL_MS = 30 * 60 * 1000;

export interface SwarmStandupTimerInput {
  readonly parentAgentId: string;
  readonly runId: string;
  readonly parentToolCallId: string;
}

export interface SwarmStandupTimerHandle {
  stop(): void;
}

export function emitSwarmCollaborationMessage(parent: Agent, message: SwarmBusMessage): void {
  parent.emitEvent({
    type: 'ultrawork.collaboration.message',
    runId: message.runId,
    message,
  });
}

export function emitSwarmCollaborationMention(
  parent: Agent,
  message: SwarmBusMessage,
  mentionExpertIds: readonly string[],
): void {
  const targets = collectMentionTargetExpertIds(message, mentionExpertIds);
  if (targets.length === 0) return;
  parent.emitEvent({
    type: 'ultrawork.collaboration.mention',
    runId: message.runId,
    message,
    mentionExpertIds: targets,
  });
}

export function startSwarmStandupTimer(
  session: Session,
  parent: Agent,
  store: ToolStore,
  input: SwarmStandupTimerInput,
  intervalMs: number = SWARM_STANDUP_INTERVAL_MS,
): SwarmStandupTimerHandle {
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    postPeriodicStandup(session, parent, store, input, tick);
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

export function deliverSwarmBusCoordination(
  session: Session,
  parent: Agent,
  message: SwarmBusMessage,
  mentionExpertIds: readonly string[],
): void {
  if (message.channel === 'blocker') {
    deliverSwarmBusBlocker(session, parent, message);
  }
  deliverSwarmBusMentions(session, parent, message, mentionExpertIds);
}

export function deliverSwarmBusMentions(
  session: Session,
  parent: Agent,
  message: SwarmBusMessage,
  mentionExpertIds: readonly string[],
): void {
  const run = parent.ultraSwarmRun;
  if (run === undefined) return;
  const targets = new Set(collectMentionTargetExpertIds(message, mentionExpertIds));
  for (const expertId of targets) {
    if (expertId === message.from.expertId) continue;
    injectSwarmBusReminder(
      session,
      run.expertAgentIds.get(expertId),
      formatSwarmBusMentionReminder(message),
      SWARM_MENTION_REMINDER_NAME,
    );
  }
}

function deliverSwarmBusBlocker(
  session: Session,
  parent: Agent,
  message: SwarmBusMessage,
): void {
  const run = parent.ultraSwarmRun;
  if (run === undefined) return;
  const reminder = formatSwarmBusBlockerReminder(message);
  for (const agentId of run.expertAgentIds.values()) {
    if (agentId === message.from.agentId) continue;
    injectSwarmBusReminder(session, agentId, reminder, SWARM_BLOCKER_REMINDER_NAME);
  }
  if (parent.turn.hasActiveTurn) {
    parent.context.appendSystemReminder(reminder, {
      kind: 'system_trigger',
      name: SWARM_BLOCKER_REMINDER_NAME,
    });
  }
}

function injectSwarmBusReminder(
  session: Session,
  agentId: string | undefined,
  reminder: string,
  name: string,
): void {
  if (agentId === undefined) return;
  const child = session.getReadyAgent?.(agentId);
  if (child === undefined || !child.turn.hasActiveTurn) return;
  child.context.appendSystemReminder(reminder, { kind: 'system_trigger', name });
}

function formatSwarmBusMentionReminder(message: SwarmBusMessage): string {
  return `[Swarm bus mention] ${sanitizeSwarmBusReminderText(message.from.name)}: ${sanitizeSwarmBusReminderText(message.body)}`;
}

function formatSwarmBusBlockerReminder(message: SwarmBusMessage): string {
  return `[Swarm bus blocker] ${sanitizeSwarmBusReminderText(message.from.name)}: ${sanitizeSwarmBusReminderText(message.body)}`;
}

function sanitizeSwarmBusReminderText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function postOrchestratorStandup(
  parent: Agent,
  input: {
    readonly parentAgentId: string;
    readonly runId: string;
    readonly parentToolCallId: string;
    readonly phase: string;
    readonly expertCount: number;
  },
  store: ToolStore = parent.tools.getStore(),
): SwarmBusMessage | undefined {
  try {
    const { message } = postSwarmBusMessage(store, {
      runId: input.runId,
      parentToolCallId: input.parentToolCallId,
      from: {
        expertId: 'ultra-swarm-orchestrator',
        agentId: input.parentAgentId,
        name: 'Swarm Control',
      },
      channel: 'standup',
      kind: 'status',
      body: `${input.phase} phase started · ${String(input.expertCount)} expert(s) active`,
      orchestratorPost: true,
    });
    emitSwarmCollaborationMessage(parent, message);
    return message;
  } catch {
    return undefined;
  }
}

export function postWaveStandup(
  parent: Agent,
  input: {
    readonly parentAgentId: string;
    readonly runId: string;
    readonly parentToolCallId: string;
    readonly phase: string;
    readonly waveIndex: number;
    readonly waveCount: number;
    readonly expertCount: number;
  },
  store: ToolStore = parent.tools.getStore(),
): SwarmBusMessage | undefined {
  try {
    const { message } = postSwarmBusMessage(store, {
      runId: input.runId,
      parentToolCallId: input.parentToolCallId,
      from: {
        expertId: 'ultra-swarm-orchestrator',
        agentId: input.parentAgentId,
        name: 'Swarm Control',
      },
      channel: 'standup',
      kind: 'status',
      body: `${input.phase} wave ${String(input.waveIndex)}/${String(input.waveCount)} complete · ${String(input.expertCount)} expert(s)`,
      orchestratorPost: true,
    });
    emitSwarmCollaborationMessage(parent, message);
    return message;
  } catch {
    return undefined;
  }
}

export function buildTeamRosterXml(team: TeamPlan): string {
  const lines = ['<team_roster>'];
  for (const expert of team.experts) {
    const lane = expert.coverageLane ?? expert.role;
    lines.push(
      `- ${expert.name} (${expert.id}) · ${lane} · focus=${expert.focus}`,
    );
  }
  lines.push('</team_roster>');
  return lines.join('\n');
}

export function buildSwarmChannelRulesXml(): string {
  return [
    '<swarm_channel_rules>',
    '- Use SwarmChannel to coordinate with peers: post status, ask questions, report blockers.',
    '- Channels: standup (progress), lane (lane work), direct (@peer), blocker (urgent), council (review notes).',
    '- Keep posts under 500 chars. Mention peers with @expert_id or @Expert Name.',
    '- Post a standup snapshot at least every 30 minutes during long implement/review work.',
    '- Call SwarmChannel list before major decisions to read recent team messages.',
    '- Review experts receive critic-edge assignments against upstream implement/plan handoffs.',
    '- Failed required reviews may receive one revision pass before council synthesis.',
    '</swarm_channel_rules>',
  ].join('\n');
}

function postPeriodicStandup(
  session: Session,
  parent: Agent,
  store: ToolStore,
  input: SwarmStandupTimerInput,
  tick: number,
): SwarmBusMessage | undefined {
  try {
    const { message } = postSwarmBusMessage(store, {
      runId: input.runId,
      parentToolCallId: input.parentToolCallId,
      from: {
        expertId: 'ultra-swarm-orchestrator',
        agentId: input.parentAgentId,
        name: 'Swarm Control',
      },
      channel: 'standup',
      kind: 'status',
      body: `Periodic standup ${String(tick)} · share progress, blockers, and next steps via SwarmChannel`,
      orchestratorPost: true,
    });
    emitSwarmCollaborationMessage(parent, message);
    const run = parent.ultraSwarmRun;
    if (run !== undefined) {
      const reminder =
        '[Swarm periodic standup] Post a brief standup update via SwarmChannel (progress, blockers, next steps).';
      for (const agentId of run.expertAgentIds.values()) {
        injectSwarmBusReminder(session, agentId, reminder, SWARM_PERIODIC_STANDUP_REMINDER_NAME);
      }
    }
    return message;
  } catch {
    return undefined;
  }
}

function collectMentionTargetExpertIds(
  message: SwarmBusMessage,
  mentionExpertIds: readonly string[],
): string[] {
  const targets = new Set<string>([
    ...(message.to === undefined ? [] : [message.to.expertId]),
    ...mentionExpertIds,
  ]);
  targets.delete(message.from.expertId);
  return [...targets];
}

export function emitCouncilDecisionFromReview(
  parent: Agent,
  input: {
    readonly runId: string;
    readonly councilExpertIds: readonly string[];
    readonly verdictSummary: string;
    readonly decision: 'approve' | 'revise' | 'block';
  },
): void {
  parent.emitEvent({
    type: 'ultrawork.council.decision',
    runId: input.runId,
    decision: {
      id: `council-${randomUUID()}`,
      runId: input.runId,
      stage: 'swarm',
      decision: input.decision,
      reason: input.verdictSummary,
      reviewerExpertIds: [...input.councilExpertIds],
    },
  });
}
