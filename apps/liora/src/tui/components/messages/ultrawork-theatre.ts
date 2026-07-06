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

import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPremiumAccentLine,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';

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

    const profile = resolveResponsiveLayout({ width: safeWidth });
    const content = this.panel === 'team-chat'
      ? this.renderTeamChatContent(safeWidth, profile)
      : this.renderOverviewContent(safeWidth, profile);

    if (profile === 'tiny') {
      return ['', ...content];
    }

    return [
      '',
      ...renderRoundedPanel({
        title: ' Ultrawork Theatre ',
        content,
        width: safeWidth,
        borderToken: 'success',
        minBoxWidth: profile === 'compact' ? 60 : 24,
      }),
    ];
  }

  private renderOverviewContent(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const lines = [
      this.renderTabBar(width, false),
      this.plainLine(`goal  ${this.objective ?? this.run?.objective ?? 'pending'}`, width, 'text'),
      this.renderStageLine(width, appearance, animated, false),
    ];

    if (profile === 'tiny') {
      lines.push(...this.renderCollaborationScrollback(width, 2, false));
      lines.push(this.plainLine(`review  ${this.reviewSummary()}`, width, 'textDim'));
      return lines;
    }

    lines.push(this.plainLine(`ops   ${this.opsSummary()}`, width, 'text'));
    if (profile === 'wide' || profile === 'ultrawide') {
      lines.push(this.plainLine(`lanes ${STAGE_LANE}`, width, 'textDim'));
    }
    lines.push(...this.renderCollaborationScrollback(width, undefined, false));
    lines.push(this.plainLine(`review  ${this.reviewSummary()}`, width, 'textDim'));
    return lines;
  }

  private renderTeamChatContent(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    const lines = [this.renderTabBar(width, false)];
    if (this.collaborationMessages.length === 0) {
      lines.push(this.plainLine('team chat  waiting for SwarmChannel traffic', width, 'textDim'));
      return lines;
    }
    lines.push(this.plainLine(
      `team chat  ${String(this.collaborationMessages.length)} message${this.collaborationMessages.length === 1 ? '' : 's'} · ${String(this.mentionCount)} mention${this.mentionCount === 1 ? '' : 's'}`,
      width,
      'text',
    ));
    const messages = profile === 'tiny'
      ? this.collaborationMessages.slice(-2)
      : this.collaborationMessages;
    lines.push(...messages.map((entry) =>
      this.renderChatLine(entry, width, entry.mentioned ? 'accent' : 'text', false),
    ));
    return lines;
  }

  private renderTabBar(width: number, indent = true): string {
    const overview = this.panel === 'overview' ? '[overview]' : ' overview ';
    const teamChat = this.panel === 'team-chat' ? '[team-chat]' : ' team-chat ';
    const prefix = indent ? '  tabs   ' : 'tabs   ';
    const text = `${prefix}${overview} | ${teamChat}`;
    return this.plainLine(text, width, this.panel === 'team-chat' ? 'primary' : 'textDim');
  }

  private renderStageLine(
    width: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    animated: boolean,
    indent = true,
  ): string {
    const prefix = indent ? '  top    ' : '';
    const text = `${prefix}stage ${this.stage ?? this.run?.stage ?? 'intake'} · verify ${this.verification?.status ?? 'pending'} · learn ${String(this.promotions.size)}`;
    if (animated) {
      return truncateToWidth(
        renderPremiumAccentLine(text, 'ultrawork-theatre:stage', appearance),
        width,
        '…',
      );
    }
    return this.plainLine(text, width, 'primary');
  }

  private plainLine(text: string, width: number, token: ColorToken): string {
    return currentTheme.fg(token, truncateToWidth(text, width, '…'));
  }

  private opsSummary(): string {
    const team = this.team === undefined
      ? 'team pending'
      : `team ${String(this.team.experts.length)}/${String(this.team.maxExperts)}`;
    const search = this.researchSummary();
    const work = this.tasks.size === 0
      ? 'work waiting'
      : `work ${String(this.tasks.size)} task${this.tasks.size === 1 ? '' : 's'}`;
    const chat = this.collaborationMessageCount === 0
      ? 'chat idle'
      : `chat ${String(this.collaborationMessageCount)} msg${this.collaborationMessageCount === 1 ? '' : 's'}`;
    return `${team} · ${search} · ${work} · ${chat}`;
  }

  private researchSummary(): string {
    const selected = [...this.backends.values()]
      .filter((backend) => backend.status === 'selected')
      .map((backend) => backend.label ?? backend.kind)
      .slice(0, 3);
    const backendText = selected.length > 0 ? selected.join(', ') : `${String(this.backends.size)} backends`;
    return `search ${backendText} · verified ${String(this.verifiedFindings.size)}`;
  }

  private reviewSummary(): string {
    const latest = [...this.decisions.values()].at(-1);
    if (latest === undefined) return 'council pending';
    if (latest.decision === 'interrupted') {
      return `interrupted: ${latest.reason}`;
    }
    return `${latest.decision}: ${latest.reason}`;
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

  private renderCollaborationScrollback(
    width: number,
    maxLines: number | undefined = UltraworkTheatreComponent.COLLABORATION_SCROLLBACK_MAX,
    indent = true,
  ): string[] {
    if (this.collaborationMessages.length === 0) return [];
    const limit = maxLines ?? UltraworkTheatreComponent.COLLABORATION_SCROLLBACK_MAX;
    const recent = this.collaborationMessages.slice(-limit);
    return recent.map((entry) => this.renderChatLine(entry, width, 'textDim', indent));
  }

  private renderChatLine(
    entry: CollaborationTimelineEntry,
    width: number,
    token: ColorToken,
    indent = true,
  ): string {
    const prefix = entry.mentioned ? '@ ' : indent ? '  ' : '';
    const channel = entry.channel === 'standup' ? 'standup' : entry.channel;
    return this.plainLine(
      `${prefix}${entry.fromName} → ${entry.target} (${channel}): ${entry.body}`,
      width,
      token,
    );
  }
}
