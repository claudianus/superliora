import { truncateToWidth, type Component } from '#/tui/renderer';

import type {
  CouncilDecision,
  Event,
  KnowledgePromotion,
  ResearchBackend,
  ResearchEvidence,
  TeamPlan,
  UltraworkRun,
  VerificationResult,
  WorkGraphNode,
} from '@superliora/sdk';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPremiumAccentLine,
  renderPremiumHeadline,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

const ULTRAWORK_THEATRE_EVENT_TYPES = new Set<Event['type']>([
  'ultrawork.stage.changed',
  'ultrawork.research.started',
  'ultrawork.research.provider.selected',
  'ultrawork.research.finding.verified',
  'ultrawork.team.staffed',
  'ultrawork.task.assigned',
  'ultrawork.collaboration.message',
  'ultrawork.collaboration.mention',
  'ultrawork.council.decision',
  'ultrawork.verification.completed',
  'ultrawork.knowledge.promoted',
]);

const STAGE_LANE = 'intake>plan>research>goal>staff>swarm>integrate>verify>learn>done';

export type UltraworkTheatrePanel = 'overview' | 'team-chat';

export type UltraworkTheatreEvent = Extract<
  Event,
  {
    readonly type:
      | 'ultrawork.stage.changed'
      | 'ultrawork.research.started'
      | 'ultrawork.research.provider.selected'
      | 'ultrawork.research.finding.verified'
      | 'ultrawork.team.staffed'
      | 'ultrawork.task.assigned'
      | 'ultrawork.collaboration.message'
      | 'ultrawork.collaboration.mention'
      | 'ultrawork.council.decision'
      | 'ultrawork.verification.completed'
      | 'ultrawork.knowledge.promoted';
  }
>;

export function isUltraworkTheatreEvent(event: Event): event is UltraworkTheatreEvent {
  return ULTRAWORK_THEATRE_EVENT_TYPES.has(event.type);
}

export function ultraworkTheatreRunId(event: UltraworkTheatreEvent): string {
  if (event.type === 'ultrawork.stage.changed') return event.run.id;
  return event.runId;
}

interface CollaborationTimelineEntry {
  readonly fromName: string;
  readonly target: string;
  readonly channel: string;
  readonly body: string;
  readonly mentioned: boolean;
}

export class UltraworkTheatreComponent implements Component {
  private run: UltraworkRun | undefined;
  private objective: string | undefined;
  private stage: UltraworkRun['stage'] | undefined;
  private readonly backends = new Map<string, ResearchBackend>();
  private readonly verifiedFindings = new Map<string, ResearchEvidence>();
  private team: TeamPlan | undefined;
  private readonly tasks = new Map<string, WorkGraphNode>();
  private readonly decisions = new Map<string, CouncilDecision>();
  private verification: VerificationResult | undefined;
  private readonly promotions = new Map<string, KnowledgePromotion>();
  private collaborationMessageCount = 0;
  private mentionCount = 0;
  private panel: UltraworkTheatrePanel = 'overview';
  private readonly collaborationMessages: CollaborationTimelineEntry[] = [];

  private static readonly COLLABORATION_SCROLLBACK_MAX = 4;
  private static readonly TEAM_CHAT_MAX = 12;

  constructor(initialEvent: UltraworkTheatreEvent) {
    this.applyEvent(initialEvent);
  }

  invalidate(): void {}

  cyclePanel(): UltraworkTheatrePanel {
    this.panel = this.panel === 'overview' ? 'team-chat' : 'overview';
    return this.panel;
  }

  applyEvent(event: UltraworkTheatreEvent): void {
    switch (event.type) {
      case 'ultrawork.stage.changed':
        this.run = event.run;
        this.objective = event.run.objective;
        this.stage = event.to;
        break;
      case 'ultrawork.research.started':
        this.objective ??= event.topic;
        for (const backend of event.backends) {
          this.backends.set(backend.id, backend);
        }
        break;
      case 'ultrawork.research.provider.selected':
        this.backends.set(event.backend.id, event.backend);
        break;
      case 'ultrawork.research.finding.verified':
        this.verifiedFindings.set(event.evidence.id, event.evidence);
        break;
      case 'ultrawork.team.staffed':
        this.team = event.team;
        break;
      case 'ultrawork.task.assigned':
        this.tasks.set(event.task.id, event.task);
        break;
      case 'ultrawork.collaboration.message':
        this.collaborationMessageCount += 1;
        this.rememberCollaborationMessage(event.message, false);
        break;
      case 'ultrawork.collaboration.mention':
        this.mentionCount += 1;
        this.markCollaborationMention(event.message);
        break;
      case 'ultrawork.council.decision':
        this.decisions.set(event.decision.id, event.decision);
        break;
      case 'ultrawork.verification.completed':
        this.verification = event.verification;
        break;
      case 'ultrawork.knowledge.promoted':
        this.promotions.set(event.promotion.id, event.promotion);
        break;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const bullet = currentTheme.boldFg('success', STATUS_BULLET);
    const title = animated
      ? `${bullet}${renderPremiumHeadline('Ultrawork Theatre', 'ultrawork-theatre:title', appearance)}`
      : `${bullet}${currentTheme.boldFg('success', ' Ultrawork Theatre')}`;
    const tabBar = this.renderTabBar(safeWidth);
    if (this.panel === 'team-chat') {
      return ['', truncateToWidth(title, safeWidth, '…'), tabBar, ...this.renderTeamChatPanel(safeWidth)];
    }
    return [
      '',
      truncateToWidth(title, safeWidth, '…'),
      tabBar,
      this.line(`  goal   ${this.objective ?? this.run?.objective ?? 'pending'}`, safeWidth, 'text'),
      this.stageLine(safeWidth, appearance, animated),
      this.line(`  lanes  ${STAGE_LANE}`, safeWidth, 'textDim'),
      this.line(`  team   ${this.teamSummary()}`, safeWidth, 'text'),
      this.line(`  search ${this.researchSummary()}`, safeWidth, 'text'),
      this.line(`  work   ${this.workSummary()}`, safeWidth, 'text'),
      this.line(`  chat   ${this.collaborationSummary()}`, safeWidth, 'textDim'),
      ...this.renderCollaborationScrollback(safeWidth),
      this.line(`  review ${this.reviewSummary()}`, safeWidth, 'textDim'),
    ];
  }

  private renderTabBar(width: number): string {
    const overview = this.panel === 'overview' ? '[overview]' : ' overview ';
    const teamChat = this.panel === 'team-chat' ? '[team-chat]' : ' team-chat ';
    const text = `  tabs   ${overview} | ${teamChat}`;
    return this.line(text, width, this.panel === 'team-chat' ? 'primary' : 'textDim');
  }

  private stageLine(
    width: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    animated: boolean,
  ): string {
    const text = `  top    stage ${this.stage ?? this.run?.stage ?? 'intake'} | verify ${this.verification?.status ?? 'pending'} | learn ${this.promotions.size}`;
    if (animated) {
      return truncateToWidth(
        renderPremiumAccentLine(text, 'ultrawork-theatre:stage', appearance),
        width,
        '…',
      );
    }
    return this.line(text, width, 'primary');
  }

  private line(text: string, width: number, token: ColorToken): string {
    return currentTheme.fg(token, truncateToWidth(text, width, '…'));
  }

  private teamSummary(): string {
    if (this.team === undefined) return 'staffing pending';
    const councilCount = this.team.councilExpertIds?.length ?? 0;
    const lanes = this.team.experts
      .slice(0, 4)
      .map((expert) => `${expert.name}:${expert.coverageLane ?? expert.role}/${expert.status}`)
      .join(', ');
    const suffix = lanes.length === 0 ? '' : ` | ${lanes}`;
    return `${String(this.team.experts.length)}/${String(this.team.maxExperts)} experts | ${this.team.intensity} | council ${String(councilCount)}${suffix}`;
  }

  private researchSummary(): string {
    const selected = [...this.backends.values()]
      .filter((backend) => backend.status === 'selected')
      .map((backend) => backend.label ?? backend.kind)
      .slice(0, 3);
    const backendText = selected.length > 0 ? selected.join(', ') : `${String(this.backends.size)} backends`;
    return `${backendText} | verified ${String(this.verifiedFindings.size)}`;
  }

  private workSummary(): string {
    const tasks = [...this.tasks.values()].slice(-3);
    if (tasks.length === 0) return 'waiting for assignments';
    return tasks
      .map((task) => `${task.title} (${task.status})`)
      .join('; ');
  }

  private reviewSummary(): string {
    const latest = [...this.decisions.values()].at(-1);
    if (latest === undefined) return 'council pending';
    return `${latest.decision}: ${latest.reason}`;
  }

  private collaborationSummary(): string {
    if (this.collaborationMessageCount === 0) return 'no bus traffic yet';
    const mentionSuffix =
      this.mentionCount === 0 ? '' : ` | ${String(this.mentionCount)} mention${this.mentionCount === 1 ? '' : 's'}`;
    return `${String(this.collaborationMessageCount)} message${this.collaborationMessageCount === 1 ? '' : 's'}${mentionSuffix}`;
  }

  private rememberCollaborationMessage(
    message: Extract<UltraworkTheatreEvent, { type: 'ultrawork.collaboration.message' }>['message'],
    mentioned: boolean,
  ): void {
    const target = message.to === undefined ? 'team' : `@${message.to.expertId}`;
    this.collaborationMessages.push({
      fromName: message.from.name,
      target,
      channel: message.channel,
      body: message.body,
      mentioned,
    });
    if (this.collaborationMessages.length > UltraworkTheatreComponent.TEAM_CHAT_MAX) {
      this.collaborationMessages.splice(
        0,
        this.collaborationMessages.length - UltraworkTheatreComponent.TEAM_CHAT_MAX,
      );
    }
  }

  private markCollaborationMention(
    message: Extract<UltraworkTheatreEvent, { type: 'ultrawork.collaboration.mention' }>['message'],
  ): void {
    for (let index = this.collaborationMessages.length - 1; index >= 0; index -= 1) {
      const entry = this.collaborationMessages[index];
      if (entry === undefined) continue;
      if (entry.fromName === message.from.name && entry.body === message.body) {
        this.collaborationMessages[index] = { ...entry, mentioned: true };
        return;
      }
    }
    this.rememberCollaborationMessage(message, true);
  }

  private renderCollaborationScrollback(width: number): string[] {
    if (this.collaborationMessages.length === 0) return [];
    const recent = this.collaborationMessages.slice(-UltraworkTheatreComponent.COLLABORATION_SCROLLBACK_MAX);
    return recent.map((entry) => this.renderChatLine(entry, width, 'textDim'));
  }

  private renderTeamChatPanel(width: number): string[] {
    if (this.collaborationMessages.length === 0) {
      return [this.line('  team chat   waiting for SwarmChannel traffic', width, 'textDim')];
    }
    const header = this.line(
      `  team chat   ${String(this.collaborationMessages.length)} message${this.collaborationMessages.length === 1 ? '' : 's'} · ${String(this.mentionCount)} mention${this.mentionCount === 1 ? '' : 's'}`,
      width,
      'text',
    );
    return [
      header,
      ...this.collaborationMessages.map((entry) =>
        this.renderChatLine(entry, width, entry.mentioned ? 'accent' : 'text'),
      ),
    ];
  }

  private renderChatLine(
    entry: CollaborationTimelineEntry,
    width: number,
    token: ColorToken,
  ): string {
    const prefix = entry.mentioned ? '@ ' : '  ';
    const channel = entry.channel === 'standup' ? 'standup' : entry.channel;
    return this.line(
      `${prefix}${entry.fromName} → ${entry.target} (${channel}): ${entry.body}`,
      width,
      token,
    );
  }
}
