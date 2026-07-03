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
} from '@moonshot-ai/kimi-code-sdk';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme, type ColorToken } from '#/tui/theme';

const ULTRAWORK_THEATRE_EVENT_TYPES = new Set<Event['type']>([
  'ultrawork.stage.changed',
  'ultrawork.research.started',
  'ultrawork.research.provider.selected',
  'ultrawork.research.finding.verified',
  'ultrawork.team.staffed',
  'ultrawork.task.assigned',
  'ultrawork.council.decision',
  'ultrawork.verification.completed',
  'ultrawork.knowledge.promoted',
]);

const STAGE_LANE = 'intake>plan>research>goal>staff>swarm>integrate>verify>learn>done';

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

  constructor(initialEvent: UltraworkTheatreEvent) {
    this.applyEvent(initialEvent);
  }

  invalidate(): void {}

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

    const title = `${currentTheme.boldFg('success', STATUS_BULLET)}${currentTheme.boldFg('success', ' Ultrawork Theatre')}`;
    return [
      '',
      truncateToWidth(title, safeWidth, '…'),
      this.line(`  goal   ${this.objective ?? this.run?.objective ?? 'pending'}`, safeWidth, 'text'),
      this.line(
        `  top    stage ${this.stage ?? this.run?.stage ?? 'intake'} | verify ${this.verification?.status ?? 'pending'} | learn ${this.promotions.size}`,
        safeWidth,
        'primary',
      ),
      this.line(`  lanes  ${STAGE_LANE}`, safeWidth, 'textDim'),
      this.line(`  team   ${this.teamSummary()}`, safeWidth, 'text'),
      this.line(`  search ${this.researchSummary()}`, safeWidth, 'text'),
      this.line(`  work   ${this.workSummary()}`, safeWidth, 'text'),
      this.line(`  review ${this.reviewSummary()}`, safeWidth, 'textDim'),
    ];
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
}
