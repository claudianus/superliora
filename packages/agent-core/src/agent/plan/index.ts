import { randomUUID } from 'node:crypto';
import { dirname, join } from 'pathe';

import type { Agent } from '..';
import { generateHeroSlug } from '../../utils/hero-slug';
import { UltraPlanModeEngine, type UltraPlanData, type UltraPlanPhase } from './ultra-plan-mode';

export type PlanData = null | {
  id: string;
  content: string;
  path: string;
};
export type PlanFilePath = string | null;

export class PlanMode {
  protected _isActive = false;
  protected _planId: null | string = null;
  protected _planFilePath: PlanFilePath = null;
  protected _isUltraMode = false;
  protected _phase: UltraPlanPhase = 'research';
  protected _interviewRoundCount = 0;
  readonly ultraEngine: UltraPlanModeEngine;

  constructor(protected readonly agent: Agent) {
    this.ultraEngine = new UltraPlanModeEngine(agent);
  }

  createPlanId(): string {
    return generateHeroSlug(randomUUID(), new Set());
  }

  async enter(
    id = this.createPlanId(),
    createFile = false,
    emitStatus = true,
    ultra = false,
    initialContext = '',
  ): Promise<void> {
    if (this._isActive) {
      throw new Error('Already in plan mode');
    }

    this._isActive = true;
    this._planId = id;
    this._planFilePath = null;
    this._isUltraMode = ultra;
    this._phase = ultra ? 'research' : 'interview';
    this._interviewRoundCount = 0;

    let enterRecorded = false;
    try {
      const planFilePath = this.planFilePathFor(id);
      this._planFilePath = planFilePath;
      await this.ensurePlanDirectory(planFilePath);
      this.agent.records.logRecord({ type: 'plan_mode.enter', id, ultra: ultra ? true : undefined });
      enterRecorded = true;
      if (createFile) {
        await this.writeEmptyPlanFile(planFilePath);
      }
      if (ultra) {
        this.ultraEngine.startInterview(initialContext);
        await this.writeUltraPlanTemplate(planFilePath);
      }
    } catch (error) {
      if (enterRecorded) {
        this.cancel(id);
      } else {
        this._isActive = false;
        this._planId = null;
        this._planFilePath = null;
        this._isUltraMode = false;
        this._phase = 'research';
        this._interviewRoundCount = 0;
      }
      throw error;
    }

    if (emitStatus) this.agent.emitStatusUpdated();
  }

  restoreEnter({ id, ultra }: { readonly id: string; readonly ultra?: boolean }): void {
    this.agent.replayBuilder.push({
      type: 'plan_updated',
      enabled: true,
    });

    this._isActive = true;
    this._planId = id;
    this._planFilePath = this.planFilePathFor(id);
    this._isUltraMode = ultra ?? false;
    this._phase = this._isUltraMode ? 'research' : 'interview';
  }

  cancel(id?: string): void {
    this.agent.records.logRecord({ type: 'plan_mode.cancel', id });
    this.agent.replayBuilder.push({
      type: 'plan_updated',
      enabled: false,
    });
    this._isActive = false;
    this._planId = null;
    this._planFilePath = null;
    this._isUltraMode = false;
    this._phase = 'research';
    this._interviewRoundCount = 0;
    this.agent.emitStatusUpdated();
  }

  async clear(): Promise<void> {
    if (!this._planFilePath) return;
    await this.writeEmptyPlanFile(this._planFilePath);
  }

  exit(id?: string): void {
    this.agent.records.logRecord({ type: 'plan_mode.exit', id });
    this.agent.replayBuilder.push({
      type: 'plan_updated',
      enabled: false,
    });
    this._isActive = false;
    this._planId = null;
    this._planFilePath = null;
    this._isUltraMode = false;
    this._phase = 'research';
    this._interviewRoundCount = 0;
    this.agent.emitStatusUpdated();
  }

  get isActive() {
    return this._isActive;
  }

  get isUltraMode() {
    return this._isUltraMode;
  }

  get phase(): UltraPlanPhase {
    return this._phase;
  }

  get interviewRoundCount(): number {
    return this._interviewRoundCount;
  }

  get planFilePath(): PlanFilePath {
    return this._planFilePath;
  }

  setPhase(phase: UltraPlanPhase): void {
    this._phase = phase;
  }

  incrementInterviewRound(): void {
    this._interviewRoundCount += 1;
  }

  recordUltraInterviewAnswers(
    questions: ReadonlyArray<{ readonly question: string; readonly header?: string }>,
    answers: Record<string, string | true>,
  ): void {
    if (!this._isActive || !this._isUltraMode || this._phase !== 'interview') return;
    this.ultraEngine.recordInterviewAnswers(questions, answers);
    this.ultraEngine.calculateAmbiguityScore();
    this._interviewRoundCount = this.ultraEngine.interviewState.rounds.length;
  }

  async data(): Promise<PlanData> {
    if (!this._planId || !this._planFilePath) return null;
    let content = '';
    try {
      content = await this.agent.kaos.readText(this._planFilePath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    return {
      id: this._planId,
      content,
      path: this._planFilePath,
    };
  }

  async ultraData(): Promise<UltraPlanData> {
    const planData = await this.data();
    return {
      seedSpec: this.ultraEngine.seedSpec,
      driftMetrics: this.ultraEngine.calculateDrift(planData?.content ?? '', []),
      stagnationPatterns: [],
      lateralThinking: this.ultraEngine.generateLateralThinking('researcher', '', ''),
      evaluationPlan: this.ultraEngine.evaluationPlan,
    };
  }

  private async writeEmptyPlanFile(path: string): Promise<void> {
    await this.ensurePlanDirectory(path);
    await this.agent.kaos.writeText(path, '');
  }

  private async writeUltraPlanTemplate(path: string): Promise<void> {
    await this.ensurePlanDirectory(path);
    const template = `# Ultra Plan\n\n## Seed Spec\n- Verifiable UltraGoal: \n- Completion Criterion: \n- Actors: \n- Inputs: \n- Outputs: \n- Constraints: \n- Non-goals: \n- Acceptance Criteria: \n- Verification Plan: \n- Failure Modes: \n- Runtime Context: \n\n## AC Tree\n- [ ] \n\n## Ontology\n- Name: \n- Fields: \n\n## Swarm Decision\nSwarm decision: \n- Decision: \n- Reason: \n- Specialist value: \n- Candidate experts: \n- Verification owner: \n- Swarm DEFER waiver: \n\n## Evaluation Plan\n- Stage 1 (Mechanical): lint, build, test\n- Stage 2 (Semantic): compliance, quality\n- Stage 3 (Consensus): if needed\n\n## Execution Plan\n<!-- Write your step-by-step plan here -->\n`;
    await this.agent.kaos.writeText(path, template);
  }

  private async ensurePlanDirectory(path: string): Promise<void> {
    await this.agent.kaos.mkdir(dirname(path), {
      parents: true,
      existOk: true,
    });
  }

  private planFilePathFor(id: string): string {
    const plansDir =
      this.agent.homedir === undefined
        ? join(this.agent.config.cwd, 'plan')
        : join(this.agent.homedir, 'plans');
    return join(plansDir, `${id}.md`);
  }
}

function isMissingFileError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT';
}
