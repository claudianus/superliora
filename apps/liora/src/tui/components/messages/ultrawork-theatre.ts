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
import { renderRoundedPanel } from '#/tui/utils/panel-frame';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderParticleRail,
  renderToneSettleFlash,
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
  'ultrawork.collaboration.debate',
  'ultrawork.collaboration.steer',
  'ultrawork.council.decision',
  'ultrawork.verification.completed',
  'ultrawork.knowledge.promoted',
]);

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
      | 'ultrawork.collaboration.debate'
      | 'ultrawork.collaboration.steer'
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

  // Debate streaming: live adversarial critique turns and user steering
  private readonly debates: {
    debateId: string;
    workNodeId: string;
    phase: string;
    expertId: string;
    expertName: string;
    text: string;
    stance?: string;
  }[] = [];
  private readonly steeringMessages: string[] = [];

  // Stage progress tracking
  private readonly stageOrder: readonly UltraworkRun['stage'][] = [
    'intake',
    'research',
    'plan',
    'staff',
    'swarm',
    'integrate',
    'verify',
    'learn',
  ] as const;

  // Arms the stage-line settle cue on first sight and on every real phase
  // change; ambient re-renders read it but never restart it.
  private stageChangedAtMs = appearanceAnimationNow();

  constructor(initialEvent: UltraworkTheatreEvent) {
    this.applyEvent(initialEvent);
  }

  invalidate(): void {}

  /** Kept for keyboard handlers; theatre is a single compact view now. */
  cyclePanel(): UltraworkTheatrePanel {
    return 'overview';
  }

  applyEvent(event: UltraworkTheatreEvent): void {
    switch (event.type) {
      case 'ultrawork.stage.changed':
        this.run = event.run;
        this.objective = event.run.objective;
        if (event.to !== this.stage) {
          this.stage = event.to;
          this.stageChangedAtMs = appearanceAnimationNow();
        }
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
      // Chat feed is owned by AgentSwarmProgress (message_id-deduped live feed).
      // Theatre never echoes collaboration message/mention bodies.
      case 'ultrawork.collaboration.message':
      case 'ultrawork.collaboration.mention':
        break;
      case 'ultrawork.collaboration.debate':
        this.debates.push({
          debateId: event.debateId,
          workNodeId: event.workNodeId,
          phase: event.phase,
          expertId: event.expertId,
          expertName: event.expertName,
          text: event.text,
          stance: event.stance,
        });
        break;
      case 'ultrawork.collaboration.steer':
        this.steeringMessages.push(event.text);
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
    if (this.isSwarmStage()) return [];

    const profile = resolveResponsiveLayout({ width: safeWidth });
    const content = this.renderCompactContent(safeWidth);

    if (profile === 'tiny') {
      return ['', ...content];
    }

    const appearance = getActiveAppearancePreferences();
    const panel = renderRoundedPanel({
      title: ' Ultrawork ',
      content,
      width: safeWidth,
      borderToken: 'success',
      minBoxWidth: profile === 'compact' ? 60 : 24,
    });
    if (!shouldRenderAmbientEffects(appearance) || safeWidth < 24) {
      return ['', ...panel];
    }
    const rail = renderParticleRail(safeWidth, appearance, 'ultrawork:theatre');
    return ['', rail, ...panel, rail];
  }

  private isSwarmStage(): boolean {
    const stage = this.stage ?? this.run?.stage;
    return stage === 'swarm';
  }

  private renderCompactContent(width: number): string[] {
    const objective = this.objective ?? this.run?.objective ?? 'pending';
    const lines = [
      this.plainLine(objective, width, 'text'),
      this.renderStageProgressLine(width),
      this.plainLine(this.progressSummary(), width, 'textDim'),
    ];
    // Debate streaming: show recent debate turns and user steering
    for (const debate of this.debates.slice(-3)) {
      const stanceIcon = debate.stance === 'oppose' ? '✗' : debate.stance === 'support' ? '✓' : '◆';
      const phaseLabel = `[${debate.phase}]`;
      const speaker = debate.expertName;
      const text = truncateToWidth(`${stanceIcon} ${phaseLabel} ${speaker}: ${debate.text}`, width);
      const tone = debate.stance === 'oppose' ? 'warning' : debate.stance === 'support' ? 'accent' : 'textDim';
      lines.push(this.plainLine(text, width, tone));
    }
    for (const steer of this.steeringMessages.slice(-2)) {
      const text = truncateToWidth(`>> ${steer}`, width);
      lines.push(this.plainLine(text, width, 'accent'));
    }
    return lines;
  }

  private stageProgressLine(): string {
    const currentStage = this.stage ?? this.run?.stage ?? 'intake';
    const currentIndex = this.stageOrder.indexOf(currentStage);
    if (currentIndex === -1) return currentStage;

    const totalStages = this.stageOrder.length;
    const progress = currentIndex / (totalStages - 1);
    const filledWidth = Math.round(progress * 8);
    const emptyWidth = 8 - filledWidth;
    const progressBar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
    const stageLabel = currentStage.replaceAll('_', ' ');
    return `${progressBar} ${stageLabel} (${currentIndex + 1}/${totalStages})`;
  }

  /**
   * Stage line with a bounded settle flash on entrance and phase change.
   * Rests on the same `textDim` bytes as the old static line; off / SSH /
   * NO_COLOR / CI skip the flash entirely (byte-identical static).
   */
  private renderStageProgressLine(width: number): string {
    const text = truncateToWidth(this.stageProgressLine(), width, '…');
    return renderToneSettleFlash(text, 'ultrawork:theatre:stage', this.stageChangedAtMs, 'textDim');
  }

  private progressSummary(): string {
    const stage = this.stage ?? this.run?.stage ?? 'intake';
    const segments = [stage.replaceAll('_', ' ')];
    if (this.team !== undefined && this.team.experts.length > 0) {
      segments.push(`${String(this.team.experts.length)} expert${this.team.experts.length === 1 ? '' : 's'}`);
    }
    const research = this.researchSummary();
    if (research.length > 0 && stage === 'research') {
      segments.push(research);
    }
    if (this.verification !== undefined) {
      segments.push(`verify ${this.verification.status}`);
    }
    if (this.promotions.size > 0) {
      segments.push(`${String(this.promotions.size)} saved`);
    }
    return segments.join(' · ');
  }

  private researchSummary(): string {
    const selected = [...this.backends.values()]
      .filter((backend) => backend.status === 'selected')
      .map((backend) => backend.label ?? backend.kind)
      .slice(0, 2);
    const backendText = selected.length > 0 ? selected.join(', ') : 'research';
    const verified = this.verifiedFindings.size;
    return verified > 0
      ? `${backendText} · ${String(verified)} finding${verified === 1 ? '' : 's'} verified`
      : backendText;
  }

  private plainLine(text: string, width: number, token: ColorToken): string {
    return currentTheme.fg(token, truncateToWidth(text, width, '…'));
  }
}
