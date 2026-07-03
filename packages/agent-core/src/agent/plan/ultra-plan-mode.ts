/**
 * UltraPlanMode - Ouroboros-inspired advanced planning system.
 *
 * Integrates Seed Spec, AC Tree, Ontology, Drift Detection,
 * Stagnation Detection, and Lateral Thinking into the existing PlanMode.
 *
 * This is NOT a copy of Ouroboros; it is a natural evolution of
 * SuperKimi's plan mode, borrowing the most powerful concepts and
 * adapting them to the existing architecture.
 */

import { extractText } from '@moonshot-ai/kosong';

import type { Agent } from '..';
import { isRealUserPromptOrigin } from '../context';

export interface SeedSpec {
  readonly goal: string;
  readonly taskType: 'code' | 'research' | 'analysis';
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly ontology: OntologySchema;
  readonly evaluationPrinciples: readonly EvaluationPrinciple[];
  readonly exitConditions: readonly ExitCondition[];
  readonly ambiguityScore: number;
  readonly createdAt: string;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly status: 'pending' | 'in_progress' | 'passed' | 'failed';
  readonly children?: readonly AcceptanceCriterion[];
}

export interface OntologySchema {
  readonly name: string;
  readonly description: string;
  readonly fields: readonly OntologyField[];
}

export interface OntologyField {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
}

export interface EvaluationPrinciple {
  readonly name: string;
  readonly description: string;
  readonly weight: number;
}

export interface ExitCondition {
  readonly name: string;
  readonly description: string;
  readonly criteria: string;
}

export interface DriftMetrics {
  readonly goalDrift: number;
  readonly constraintDrift: number;
  readonly ontologyDrift: number;
}

export const ULTRA_PLAN_DRIFT_THRESHOLD = 0.3;

export function combinedDrift(metrics: DriftMetrics): number {
  return metrics.goalDrift * 0.5 + metrics.constraintDrift * 0.3 + metrics.ontologyDrift * 0.2;
}

export function isDriftAcceptable(metrics: DriftMetrics): boolean {
  return combinedDrift(metrics) <= ULTRA_PLAN_DRIFT_THRESHOLD;
}

export type InterviewPerspective =
  | 'researcher'
  | 'simplifier'
  | 'architect'
  | 'breadth-keeper'
  | 'seed-closer';

export type UltraPlanPhase = 'research' | 'interview' | 'design' | 'review' | 'write' | 'exit';

export type AmbiguityMilestone = 'initial' | 'progress' | 'refined' | 'ready';

export interface InterviewRound {
  readonly roundNumber: number;
  readonly question: string;
  readonly userResponse: string;
  readonly timestamp: number;
}

export interface AmbiguityScoreBreakdown {
  readonly name: string;
  readonly clarityScore: number;
  readonly weight: number;
  readonly justification: string;
}

export interface AmbiguityScoreResult {
  readonly overallScore: number;
  readonly breakdown: readonly AmbiguityScoreBreakdown[];
  readonly isReadyForSeed: boolean;
  readonly milestone: AmbiguityMilestone;
  readonly floorFailures: readonly string[];
}

export interface InterviewState {
  readonly rounds: readonly InterviewRound[];
  readonly initialContext: string;
  readonly ambiguityScore: AmbiguityScoreResult | null;
  readonly completionCandidateStreak: number;
  readonly lastReadyEvidenceHash?: string;
  readonly lastReadyRoundCount?: number;
}

export const ULTRA_PLAN_REQUIRED_SECTIONS = [
  'goal',
  'actors',
  'inputs',
  'outputs',
  'constraints',
  'non_goals',
  'acceptance_criteria',
  'verification_plan',
  'failure_modes',
  'runtime_context',
] as const;

export type UltraPlanRequiredSection = typeof ULTRA_PLAN_REQUIRED_SECTIONS[number];

const AMBIGUITY_THRESHOLD = 0.2;
const COMPLETION_STREAK_REQUIRED = 2;
const GOAL_CLARITY_FLOOR = 0.75;
const CONSTRAINT_CLARITY_FLOOR = 0.65;
const SUCCESS_CRITERIA_CLARITY_FLOOR = 0.70;

export interface UltraPlanReadiness {
  readonly ready: boolean;
  readonly stableReady: boolean;
  readonly openGaps: readonly UltraPlanRequiredSection[];
  readonly ambiguityScore: AmbiguityScoreResult;
  readonly verifiableGoal: boolean;
  readonly completionCandidateStreak: number;
  readonly floorFailures: readonly string[];
}

export type StagnationPatternType =
  | 'spinning'
  | 'oscillation'
  | 'no_drift'
  | 'diminishing_returns';

export interface StagnationDetection {
  readonly pattern: StagnationPatternType;
  readonly detected: boolean;
  readonly confidence: number;
  readonly evidence: Record<string, unknown>;
}

export type ThinkingPersona =
  | 'hacker'
  | 'researcher'
  | 'simplifier'
  | 'architect'
  | 'contrarian';

export interface LateralThinkingResult {
  readonly persona: ThinkingPersona;
  readonly prompt: string;
  readonly approachSummary: string;
  readonly questions: readonly string[];
}

export interface EvaluationPlan {
  readonly stage1Mechanical: boolean;
  readonly stage2Semantic: boolean;
  readonly stage3Consensus: boolean;
  readonly mechanicalChecks: readonly string[];
  readonly semanticCriteria: readonly string[];
}

export interface UltraPlanData {
  readonly seedSpec: SeedSpec | null;
  readonly driftMetrics: DriftMetrics | null;
  readonly stagnationPatterns: readonly StagnationDetection[];
  readonly lateralThinking: LateralThinkingResult | null;
  readonly evaluationPlan: EvaluationPlan | null;
}

interface StagnationHistoryEntry {
  readonly timestamp: number;
  readonly phaseOutputs: readonly string[];
  readonly errorSignatures: readonly string[];
  readonly driftScores: readonly number[];
  readonly detections: readonly StagnationDetection[];
}

export class UltraPlanModeEngine {
  private readonly agent: Agent;
  private _seedSpec: SeedSpec | null = null;
  private _driftMetrics: DriftMetrics | null = null;
  private _stagnationHistory: StagnationHistoryEntry[] = [];
  private _evaluationPlan: EvaluationPlan | null = null;
  private _lateralThinking: LateralThinkingResult | null = null;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  setSeedSpec(seed: SeedSpec): void {
    this._seedSpec = seed;
  }

  reopenInterviewForSeedRefinement(metrics: DriftMetrics): void {
    this._seedSpec = null;
    this._driftMetrics = metrics;
    this._interviewState = {
      ...this._interviewState,
      ambiguityScore: null,
      completionCandidateStreak: 0,
      lastReadyEvidenceHash: undefined,
      lastReadyRoundCount: -1,
    };
  }

  get seedSpec(): SeedSpec | null {
    return this._seedSpec;
  }

  buildSeedSpec(
    goal: string,
    constraints: string[],
    acceptanceCriteria: string[],
    ontologyName: string,
    ontologyFields: OntologyField[],
  ): SeedSpec {
    return {
      goal,
      taskType: 'code',
      constraints: [...constraints],
      acceptanceCriteria: acceptanceCriteria.map((desc, i) => ({
        id: `ac_${i + 1}`,
        description: desc,
        status: 'pending',
      })),
      ontology: {
        name: ontologyName,
        description: `Ontology for ${ontologyName}`,
        fields: [...ontologyFields],
      },
      evaluationPrinciples: [
        { name: 'completeness', description: 'All requirements are met', weight: 1.0 },
        { name: 'correctness', description: 'Implementation is correct', weight: 1.0 },
        { name: 'clarity', description: 'Code is clear and maintainable', weight: 0.8 },
      ],
      exitConditions: [
        {
          name: 'all_criteria_met',
          description: 'All acceptance criteria satisfied',
          criteria: '100% criteria pass',
        },
      ],
      ambiguityScore: 0.15,
      createdAt: new Date().toISOString(),
    };
  }

  generateSeedSpecFromInterview(
    goal: string,
    constraints: string[],
    acceptanceCriteria: string[],
    ontologyName: string,
    ontologyFields: OntologyField[],
  ): SeedSpec {
    return this.buildSeedSpec(goal, constraints, acceptanceCriteria, ontologyName, ontologyFields);
  }

  calculateDrift(currentOutput: string, constraintViolations: string[]): DriftMetrics {
    if (!this._seedSpec) {
      return { goalDrift: 0, constraintDrift: 0, ontologyDrift: 0 };
    }

    const goalDrift = this._calculateGoalDrift(currentOutput);
    const constraintDrift = Math.min(constraintViolations.length * 0.1, 1.0);
    const ontologyDrift = this._calculateOntologyDrift(currentOutput);

    const metrics = { goalDrift, constraintDrift, ontologyDrift };
    this._driftMetrics = metrics;
    return metrics;
  }

  private _calculateGoalDrift(currentOutput: string): number {
    if (!this._seedSpec) return 0;
    const seedTerms = this._seedSpecKeyTerms();
    const outputWords = this._tokenize(currentOutput);
    if (seedTerms.size === 0 || outputWords.size === 0) {
      return seedTerms.size > 0 ? 1.0 : 0;
    }
    const intersection = new Set([...seedTerms].filter((x) => outputWords.has(x)));
    const similarity = intersection.size / seedTerms.size;
    return 1.0 - similarity;
  }

  private _seedSpecKeyTerms(): Set<string> {
    if (!this._seedSpec) return new Set();
    const terms = this._tokenize(this._seedSpec.goal);
    for (const constraint of this._seedSpec.constraints) {
      for (const term of this._tokenize(constraint)) {
        terms.add(term);
      }
    }
    for (const criterion of this._seedSpec.acceptanceCriteria) {
      for (const term of this._tokenize(criterion.description)) {
        terms.add(term);
      }
    }
    return terms;
  }

  private _calculateOntologyDrift(currentOutput: string): number {
    if (!this._seedSpec) return 0;
    const seedConcepts = new Set(
      this._seedSpec.ontology.fields.map((f) => f.name.toLowerCase()),
    );
    if (!seedConcepts.size) return 0;
    const outputWords = this._tokenize(currentOutput);
    const intersection = new Set([...seedConcepts].filter((x) => outputWords.has(x)));
    const similarity = intersection.size / seedConcepts.size;
    return 1.0 - similarity;
  }

  private _tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  }

  detectStagnation(
    phaseOutputs: string[],
    errorSignatures: string[],
    driftScores: number[],
  ): StagnationDetection[] {
    const results: StagnationDetection[] = [
      this._detectSpinning(phaseOutputs, errorSignatures),
      this._detectOscillation(phaseOutputs),
      this._detectNoDrift(driftScores),
      this._detectDiminishingReturns(driftScores),
    ];

    this._stagnationHistory.push({
      timestamp: Date.now(),
      phaseOutputs: [...phaseOutputs],
      errorSignatures: [...errorSignatures],
      driftScores: [...driftScores],
      detections: [...results],
    });

    return results;
  }

  private _detectSpinning(
    _phaseOutputs: string[],
    errorSignatures: string[],
  ): StagnationDetection {
    const threshold = 3;
    const hashes = errorSignatures.map((e) => this._hash(e));
    const last = hashes.slice(-threshold);
    const detected = last.length >= threshold && last.every((h) => h === last[0]);
    return {
      pattern: 'spinning',
      detected,
      confidence: detected ? 0.9 : 0.0,
      evidence: { threshold, lastErrors: errorSignatures.slice(-threshold) },
    };
  }

  private _detectOscillation(phaseOutputs: string[]): StagnationDetection {
    const cycles = 2;
    const hashes = phaseOutputs.map((o) => this._hash(o));
    if (hashes.length < cycles * 2) {
      return { pattern: 'oscillation', detected: false, confidence: 0.0, evidence: {} };
    }
    const n = hashes.length;
    const detected =
      hashes[n - 1] === hashes[n - 3] && hashes[n - 2] === hashes[n - 4];
    return {
      pattern: 'oscillation',
      detected,
      confidence: detected ? 0.85 : 0.0,
      evidence: { cycles, lastOutputs: phaseOutputs.slice(-cycles * 2) },
    };
  }

  private _detectNoDrift(driftScores: number[]): StagnationDetection {
    const threshold = 3;
    const epsilon = 0.01;
    if (driftScores.length < threshold) {
      return { pattern: 'no_drift', detected: false, confidence: 0.0, evidence: {} };
    }
    const last = driftScores.slice(-threshold);
    const maxDiff = Math.max(...last) - Math.min(...last);
    const detected = maxDiff < epsilon;
    return {
      pattern: 'no_drift',
      detected,
      confidence: detected ? 0.8 : 0.0,
      evidence: { threshold, maxDiff, lastScores: last },
    };
  }

  private _detectDiminishingReturns(driftScores: number[]): StagnationDetection {
    const threshold = 3;
    if (driftScores.length < threshold + 1) {
      return { pattern: 'diminishing_returns', detected: false, confidence: 0.0, evidence: {} };
    }
    const improvements: number[] = [];
    for (let i = 1; i < driftScores.length; i++) {
      improvements.push((driftScores[i] ?? 0) - (driftScores[i - 1] ?? 0));
    }
    const last = improvements.slice(-threshold);
    const avgImprovement = last.reduce((a, b) => a + b, 0) / last.length;
    const detected = avgImprovement < 0.01;
    return {
      pattern: 'diminishing_returns',
      detected,
      confidence: detected ? 0.75 : 0.0,
      evidence: { threshold, avgImprovement, lastImprovements: last },
    };
  }

  private _hash(text: string): string {
    let h1 = 5381;
    let h2 = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) | 0;
      h2 = (h2 * 33 + c) | 0;
    }
    return `${h1.toString(36)}:${h2.toString(36)}`;
  }

  generateLateralThinking(
    persona: ThinkingPersona,
    problemContext: string,
    currentApproach: string,
  ): LateralThinkingResult {
    const summaries: Record<ThinkingPersona, string> = {
      hacker: 'Find unconventional workarounds and bypasses',
      researcher: 'Seek additional information and context',
      simplifier: 'Reduce complexity and challenge assumptions',
      architect: 'Restructure the approach fundamentally',
      contrarian: 'Challenge assumptions and invert the problem',
    };

    const prompt = `You are acting as a ${persona}.\n${summaries[persona]}.\n\nProblem context: ${problemContext}\nCurrent approach: ${currentApproach}\n\nGenerate an alternative approach from this perspective. Be specific and actionable.`;

    const questions = this._generateQuestionsForPersona(persona, problemContext);

    const result: LateralThinkingResult = {
      persona,
      prompt,
      approachSummary: summaries[persona],
      questions,
    };

    this._lateralThinking = result;
    return result;
  }

  private _generateQuestionsForPersona(
    persona: ThinkingPersona,
    _context: string,
  ): string[] {
    const questionBanks: Record<ThinkingPersona, string[]> = {
      hacker: [
        'What is the simplest workaround?',
        'What assumption can we bypass?',
        'What is the minimal viable fix?',
      ],
      researcher: [
        'What information are we missing?',
        'What similar problems have been solved?',
        'What documentation should we read?',
      ],
      simplifier: [
        'What can we remove without breaking it?',
        'What is the core problem, not the symptoms?',
        'Can we solve a smaller version first?',
      ],
      architect: [
        'What is the fundamental structure?',
        'How would we design this from scratch?',
        'What abstraction would clarify this?',
      ],
      contrarian: [
        'What if the opposite is true?',
        'What assumption is most dangerous?',
        'What would make this definitely fail?',
      ],
    };
    return questionBanks[persona];
  }

  setEvaluationPlan(plan: EvaluationPlan): void {
    this._evaluationPlan = plan;
  }

  get evaluationPlan(): EvaluationPlan | null {
    return this._evaluationPlan;
  }

  generateDefaultEvaluationPlan(): EvaluationPlan {
    return {
      stage1Mechanical: true,
      stage2Semantic: true,
      stage3Consensus: false,
      mechanicalChecks: ['lint', 'build', 'test', 'static_analysis', 'coverage'],
      semanticCriteria: ['ac_compliance', 'code_quality', 'maintainability'],
    };
  }

  serialize(): Record<string, unknown> {
    return {
      seedSpec: this._seedSpec,
      driftMetrics: this._driftMetrics,
      stagnationHistory: this._stagnationHistory,
      evaluationPlan: this._evaluationPlan,
      lateralThinking: this._lateralThinking,
    };
  }

  // ---------------------------------------------------------------------------
  // Interview & Ambiguity Scoring
  // ---------------------------------------------------------------------------

  private _currentPerspective: InterviewPerspective = 'researcher';
  private readonly _perspectives: InterviewPerspective[] = [
    'researcher',
    'simplifier',
    'architect',
    'breadth-keeper',
    'seed-closer',
  ];

  private _interviewState: InterviewState = {
    rounds: [],
    initialContext: '',
    ambiguityScore: null,
    completionCandidateStreak: 0,
    lastReadyEvidenceHash: undefined,
    lastReadyRoundCount: -1,
  };

  get interviewState(): InterviewState {
    return this._interviewState;
  }

  get currentPerspective(): InterviewPerspective {
    return this._currentPerspective;
  }

  advancePerspective(): void {
    const idx = this._perspectives.indexOf(this._currentPerspective);
    this._currentPerspective = this._perspectives[(idx + 1) % this._perspectives.length] ?? 'researcher';
  }

  getPerspectiveDescription(): string {
    const descriptions: Record<InterviewPerspective, string> = {
      researcher: 'Explore the problem space broadly. Ask about background, context, and what has been tried before.',
      simplifier: 'Reduce complexity. Challenge assumptions and ask what can be removed or simplified.',
      architect: 'Think about structure and design. Ask about components, interfaces, and technical decisions.',
      'breadth-keeper': 'Ensure nothing is missed. Ask about edge cases, non-goals, and scope boundaries.',
      'seed-closer': 'Focus on precision and closure. Ask for specific, measurable criteria and final details.',
    };
    return descriptions[this._currentPerspective];
  }

  startInterview(initialContext: string): void {
    this._interviewState = {
      rounds: [],
      initialContext,
      ambiguityScore: null,
      completionCandidateStreak: 0,
      lastReadyEvidenceHash: undefined,
    };
  }

  addInterviewRound(question: string, userResponse: string): void {
    const round: InterviewRound = {
      roundNumber: this._interviewState.rounds.length + 1,
      question,
      userResponse,
      timestamp: Date.now(),
    };
    this.advancePerspective();
    this._interviewState = {
      ...this._interviewState,
      rounds: [...this._interviewState.rounds, round],
    };
  }

  recordInterviewAnswers(
    questions: ReadonlyArray<{ readonly question: string; readonly header?: string }>,
    answers: Record<string, string | true>,
  ): void {
    const answerText = Object.entries(answers)
      .map(([key, value]) => `${key}: ${value === true ? 'true' : value}`)
      .join('\n');
    const questionText = questions
      .map((q) => q.header === undefined || q.header.length === 0
        ? q.question
        : `${q.header}: ${q.question}`)
      .join('\n');
    this.addInterviewRound(questionText, answerText);
  }

  /**
   * Calculate ambiguity score from interview state.
   * This mirrors the Ouroboros gate shape locally: weighted clarity dimensions,
   * required section gaps, per-dimension floors, and a two-signal closure streak.
   */
  calculateAmbiguityScore(): AmbiguityScoreResult {
    const rounds = this._interviewState.rounds;
    const totalRounds = rounds.length;

    const sectionResolution = new Map(
      ULTRA_PLAN_REQUIRED_SECTIONS.map((section) => [
        section,
        this.sectionResolution(section),
      ]),
    );
    const resolved = (section: UltraPlanRequiredSection): boolean =>
      sectionResolution.get(section)?.resolved === true;

    const evidenceText = this.interviewEvidenceText();
    const normalizedEvidence = evidenceText.toLowerCase();
    const detailClarity = Math.min(this.tokenCount(evidenceText) / 120, 1.0);
    const answerRoundClarity = Math.min(totalRounds / 3, 1.0);

    const goalSectionClarity = this.averageBooleanClarity([
      resolved('goal'),
      resolved('actors'),
      resolved('inputs'),
      resolved('outputs'),
    ]);
    const constraintSectionClarity = this.averageBooleanClarity([
      resolved('constraints'),
      resolved('non_goals'),
      resolved('failure_modes'),
      resolved('runtime_context'),
    ]);
    const criteriaSectionClarity = this.averageBooleanClarity([
      resolved('acceptance_criteria'),
      resolved('verification_plan'),
      this.hasVerifiableGoal(),
    ]);

    const specificityClarity = (
      Number(/\b(?:file|path|test|run|command|screen|api|component|module|repo|workspace)\b|(?:파일|경로|테스트|실행|화면|컴포넌트|모듈|레포|작업\s?공간)/i.test(normalizedEvidence)) +
      Number(/\b(?:must|must not|cannot|only|except|exclude|non-goal|out of scope)\b|(?:반드시|금지|제외|범위\s?밖|하지\s?않)/i.test(normalizedEvidence)) +
      Number(/\b(?:pass|fail|verify|check|acceptance|complete|incomplete|true|false)\b|(?:통과|실패|검증|확인|완료|미완료|참|거짓)/i.test(normalizedEvidence))
    ) / 3;

    const goalClarity = this.clampClarity(
      goalSectionClarity * 0.7 + detailClarity * 0.2 + answerRoundClarity * 0.1,
    );
    const constraintClarity = this.clampClarity(
      constraintSectionClarity * 0.75 + specificityClarity * 0.15 + detailClarity * 0.1,
    );
    const criteriaClarity = this.clampClarity(
      criteriaSectionClarity * 0.75 + specificityClarity * 0.15 + detailClarity * 0.1,
    );

    const rawOverall = 1.0 - (
      goalClarity * 0.4 +
      constraintClarity * 0.3 +
      criteriaClarity * 0.3
    );

    const openGaps = ULTRA_PLAN_REQUIRED_SECTIONS.filter((section) => !resolved(section));
    const gapPressure = openGaps.length / ULTRA_PLAN_REQUIRED_SECTIONS.length;
    const verifiableGoal = this.hasVerifiableGoal();
    const floorFailures = this.floorFailures(goalClarity, constraintClarity, criteriaClarity);
    const floorPressure = floorFailures.length > 0 ? AMBIGUITY_THRESHOLD + 0.01 : 0;
    const gatedOverall = this.clampClarity(
      Math.max(rawOverall, gapPressure, verifiableGoal ? 0 : 0.45, floorPressure),
    );

    const milestone: AmbiguityMilestone =
      gatedOverall <= AMBIGUITY_THRESHOLD ? 'ready' :
      gatedOverall <= 0.3 ? 'refined' :
      gatedOverall <= 0.4 ? 'progress' : 'initial';

    const isReady = (
      gatedOverall <= AMBIGUITY_THRESHOLD &&
      openGaps.length === 0 &&
      verifiableGoal &&
      floorFailures.length === 0
    );
    const evidenceHash = this._hash(this.interviewEvidenceText());

    const lastReadyRoundCount = this._interviewState.lastReadyRoundCount ?? -1;
    const hasNewRoundSinceLastReady =
      this._interviewState.rounds.length > lastReadyRoundCount;
    const evidenceChanged =
      this._interviewState.lastReadyEvidenceHash !== evidenceHash;

    if (isReady && (evidenceChanged || hasNewRoundSinceLastReady)) {
      this._interviewState = {
        ...this._interviewState,
        completionCandidateStreak: this._interviewState.completionCandidateStreak + 1,
        lastReadyEvidenceHash: evidenceHash,
        lastReadyRoundCount: this._interviewState.rounds.length,
      };
    } else {
      this._interviewState = {
        ...this._interviewState,
        completionCandidateStreak: isReady ? this._interviewState.completionCandidateStreak : 0,
        lastReadyEvidenceHash: isReady ? this._interviewState.lastReadyEvidenceHash : undefined,
        lastReadyRoundCount: isReady ? this._interviewState.lastReadyRoundCount : -1,
      };
    }

    const result: AmbiguityScoreResult = {
      overallScore: gatedOverall,
      breakdown: [
        { name: 'goal_clarity', clarityScore: goalClarity, weight: 0.4, justification: `Resolved goal sections: ${this.resolvedSectionNames(sectionResolution, ['goal', 'actors', 'inputs', 'outputs'])}` },
        { name: 'constraint_clarity', clarityScore: constraintClarity, weight: 0.3, justification: `Resolved constraint sections: ${this.resolvedSectionNames(sectionResolution, ['constraints', 'non_goals', 'failure_modes', 'runtime_context'])}` },
        { name: 'success_criteria_clarity', clarityScore: criteriaClarity, weight: 0.3, justification: `Resolved success sections: ${this.resolvedSectionNames(sectionResolution, ['acceptance_criteria', 'verification_plan'])}; verifiable_goal=${verifiableGoal ? 'true' : 'false'}` },
        { name: 'seed_ledger_gaps', clarityScore: 1 - gapPressure, weight: 1, justification: `Open required sections: ${openGaps.length === 0 ? 'none' : openGaps.join(', ')}` },
        { name: 'verifiable_goal', clarityScore: verifiableGoal ? 1 : 0, weight: 1, justification: 'UltraGoal must be judgeable as complete or incomplete.' },
      ],
      isReadyForSeed: isReady,
      milestone,
      floorFailures,
    };

    this._interviewState = {
      ...this._interviewState,
      ambiguityScore: result,
    };

    return result;
  }

  /**
   * Check if interview can auto-complete (2 consecutive ready scores).
   */
  canAutoComplete(): boolean {
    return (
      this._interviewState.ambiguityScore?.isReadyForSeed === true &&
      this._interviewState.completionCandidateStreak >= COMPLETION_STREAK_REQUIRED
    );
  }

  interviewReadiness(): UltraPlanReadiness {
    const ambiguityScore = this.calculateAmbiguityScore();
    const openGaps = this.openSeedGaps();
    const verifiableGoal = this.hasVerifiableGoal();
    const stableReady = ambiguityScore.isReadyForSeed && this.canAutoComplete();
    return {
      ready: ambiguityScore.isReadyForSeed && openGaps.length === 0 && verifiableGoal,
      stableReady,
      openGaps,
      ambiguityScore,
      verifiableGoal,
      completionCandidateStreak: this._interviewState.completionCandidateStreak,
      floorFailures: ambiguityScore.floorFailures,
    };
  }

  openSeedGaps(): readonly UltraPlanRequiredSection[] {
    return ULTRA_PLAN_REQUIRED_SECTIONS.filter((section) => !this.sectionResolved(section));
  }

  readinessBlockerMessage(): string {
    const readiness = this.interviewReadiness();
    const gaps = readiness.openGaps.length === 0 ? 'none' : readiness.openGaps.join(', ');
    const floorFailures = readiness.floorFailures.length === 0 ? 'none' : readiness.floorFailures.join('; ');
    return [
      'UltraPlan interview is not ready for Design.',
      `ambiguity=${readiness.ambiguityScore.overallScore.toFixed(3)}`,
      `verifiable_goal=${readiness.verifiableGoal ? 'true' : 'false'}`,
      `dimension_floor_failures=${floorFailures}`,
      `open_gaps=${gaps}`,
      'Continue AskUserQuestion until the UltraGoal is true/false-verifiable, every clarity floor is met, and every required Seed section is resolved.',
    ].join('\n');
  }

  /**
   * Generate Seed Spec from interview results.
   * Extracts Goal, Constraints, AC, and Ontology from Q&A.
   */
  autoGenerateSeedSpecFromInterview(ontologyName: string): SeedSpec {
    const allText = this.interviewEvidenceText();

    // Extract goal from first round or initial context
    const goal = this._extractGoal(allText) || this._interviewState.initialContext;

    // Extract constraints from responses
    const constraints = this._extractConstraints(allText);

    // Extract acceptance criteria
    const acceptanceCriteria = this._extractAcceptanceCriteria(allText);

    // Generate ontology from domain terms
    const ontologyFields = this._extractOntologyFields(allText);

    return this.buildSeedSpec(
      goal,
      constraints,
      acceptanceCriteria,
      ontologyName,
      ontologyFields,
    );
  }

  private _extractGoal(text: string): string {
    const match = text.match(/goal[:\s]+(.+?)(?:\n|$)/i);
    return match?.[1]?.trim() ?? '';
  }

  private interviewEvidenceText(): string {
    return [
      this._interviewState.initialContext,
      ...this.recentUserPromptTexts(),
      ...this._interviewState.rounds.map((r) => r.userResponse),
    ].join('\n');
  }

  private interviewEvidenceCorpus(): string {
    return this.interviewEvidenceText().toLowerCase();
  }

  private recentUserPromptTexts(): string[] {
    return (this.agent.context?.history ?? [])
      .filter((message) => message.role === 'user' && isRealUserPromptOrigin(message.origin))
      .slice(-3)
      .map((message) => extractText(message, '\n').trim())
      .filter((text) => text.length > 0);
  }

  private averageBooleanClarity(values: readonly boolean[]): number {
    if (values.length === 0) return 0;
    return values.filter(Boolean).length / values.length;
  }

  private tokenCount(text: string): number {
    return text.split(/[\s,.;:()[\]{}"'`]+/).filter((token) => token.length > 0).length;
  }

  private clampClarity(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private floorFailures(
    goalClarity: number,
    constraintClarity: number,
    criteriaClarity: number,
  ): readonly string[] {
    const failures: string[] = [];
    if (goalClarity < GOAL_CLARITY_FLOOR) {
      failures.push(`Goal Clarity ${goalClarity.toFixed(2)} < ${GOAL_CLARITY_FLOOR.toFixed(2)}`);
    }
    if (constraintClarity < CONSTRAINT_CLARITY_FLOOR) {
      failures.push(`Constraint Clarity ${constraintClarity.toFixed(2)} < ${CONSTRAINT_CLARITY_FLOOR.toFixed(2)}`);
    }
    if (criteriaClarity < SUCCESS_CRITERIA_CLARITY_FLOOR) {
      failures.push(`Success Criteria Clarity ${criteriaClarity.toFixed(2)} < ${SUCCESS_CRITERIA_CLARITY_FLOOR.toFixed(2)}`);
    }
    return failures;
  }

  private resolvedSectionNames(
    resolution: ReadonlyMap<UltraPlanRequiredSection, { readonly resolved: boolean }>,
    sections: readonly UltraPlanRequiredSection[],
  ): string {
    const resolved = sections.filter((section) => resolution.get(section)?.resolved === true);
    return resolved.length === 0 ? 'none' : resolved.join(', ');
  }

  private sectionResolved(section: UltraPlanRequiredSection): boolean {
    return this.sectionResolution(section).resolved;
  }

  private sectionResolution(section: UltraPlanRequiredSection): {
    readonly resolved: boolean;
    readonly evidence: string;
  } {
    const text = this.interviewEvidenceText();
    const labelEvidence = this.labeledSectionEvidence(section, text);
    if (labelEvidence !== null) {
      return { resolved: true, evidence: labelEvidence };
    }

    const fallbackPatterns: Record<UltraPlanRequiredSection, RegExp> = {
      goal: /\b(?:build|create|make|implement|fix|improve|ship|deliver|objective|goal|task)\b|(?:만들|구현|수정|개선|배포|완성|목표|작업|하고자|하려|해결|처리)/i,
      actors: /\b(?:actor|user|owner|agent|stakeholder|developer|operator|customer|player)\b|(?:사용자|행위자|담당|주체|소유자|개발자|플레이어|에이전트|검증자|운영자|모델)/i,
      inputs: /\b(?:input|source|given|file|prompt|path|repo|repository|asset|api|test)\b|(?:입력|소스|파일|프롬프트|경로|레포|자산|테스트|코드|저장소|리포지토리|데이터)/i,
      outputs: /\b(?:outputs?|deliverables?|results?|artifacts?|report|edit|patch|screen|feature|game|app)\b|(?:출력|산출물|결과|수정|패치|화면|기능|게임|앱|코드|파일|변경|배포)/i,
      constraints: /\b(?:constraint|limit|must|must not|cannot|only|exactly|required|forbid)\b|(?:제약|제한|조건|반드시|하지\s?말|불가|오직|필수|허용|범위|최소|최대)/i,
      non_goals: /\b(?:non-goal|non_goals|out of scope|not doing|do not|no unrelated|exclude|skip)\b|(?:제외|범위\s?밖|비목표|무관|별도|미포함|스킵|하지\s?않|안\s?함)/i,
      acceptance_criteria: /\b(?:acceptance|criteria|requirement|pass|fail|completion criterion|done when|works when)\b|(?:완료\s?조건|수락|검증\s?기준|통과|실패|완료될\s?때|기준|조건|성공)/i,
      verification_plan: /\b(?:verify|verification|test|check|run|inspect|assert|screenshot)\b|(?:검증|테스트|확인|실행|점검|스크린샷|검사|체크)/i,
      failure_modes: /\b(?:failure|risk|edge case|error|exception|rollback|regression|break)\b|(?:실패|위험|예외|오류|회귀|깨짐|롤백|문제|장애|리스크|버그)/i,
      runtime_context: /\b(?:runtime|environment|cwd|repo|repository|workspace|worktree|platform|browser|node|typescript)\b|(?:환경|런타임|레포|작업\s?공간|워크트리|브라우저|노드|타입스크립트|저장소|워크스페이스|monorepo|로컬)/i,
    };
    const match = fallbackPatterns[section].exec(text);
    return {
      resolved: match !== null,
      evidence: match?.[0] ?? '',
    };
  }

  private labeledSectionEvidence(section: UltraPlanRequiredSection, text: string): string | null {
    const labelAlternatives: Record<UltraPlanRequiredSection, readonly string[]> = {
      goal: ['goal', 'objective', 'ultragoal', 'verifiable ultragoal', 'purpose', 'task', '목표', '작업'],
      actors: ['actors?', 'users?', 'owners?', 'stakeholders?', '행위자', '사용자', '담당', '주체'],
      inputs: ['inputs?', 'sources?', 'given', 'files?', 'paths?', '입력', '소스', '파일', '경로'],
      outputs: ['outputs?', 'deliverables?', 'results?', 'artifacts?', '산출물', '출력', '결과'],
      constraints: ['constraints?', 'limits?', 'requirements?', '제약', '제한', '필수 조건'],
      non_goals: ['non[-_ ]?goals?', 'out of scope', 'excluded?', '제외', '범위 밖', '비목표'],
      acceptance_criteria: ['acceptance criteria', 'criteria', 'requirements?', 'completion criteria?', '완료 조건', '수락 기준', '검증 기준'],
      verification_plan: ['verification plan', 'verification', 'tests?', 'checks?', '검증 계획', '검증', '테스트'],
      failure_modes: ['failure modes?', 'risks?', 'edge cases?', 'errors?', '실패 모드', '실패', '위험', '예외'],
      runtime_context: ['runtime context', 'runtime', 'environment', 'workspace', 'repo', 'repository', '런타임', '환경', '레포', '작업 환경'],
    };
    const labels = labelAlternatives[section].join('|');
    const regex = new RegExp(
      `(?:^|[\\n;])\\s*(?:[-*]\\s*)?(?:${labels})\\s*[:：-]\\s*([^\\n;]+)`,
      'iu',
    );
    const match = regex.exec(text);
    const evidence = match?.[1]?.trim();
    if (evidence === undefined || evidence.length === 0) return null;
    return evidence;
  }

  private hasVerifiableGoal(): boolean {
    const text = this.interviewEvidenceCorpus();
    const hasGoal = this.sectionResolved('goal');
    const hasBinaryLanguage =
      /\b(true|false|pass|fail|complete|incomplete|done|not done|1|0|ok|yes|no)\b|(?:참|거짓|통과|실패|완료|미완료|된다|안된다|맞다|틀리다|가능|불가|예|아니오|성공|승인|거부|허용)/i.test(
        text,
      );
    return hasGoal && this.sectionResolved('acceptance_criteria') && this.sectionResolved('verification_plan') && hasBinaryLanguage;
  }

  private _extractConstraints(text: string): string[] {
    const matches = text.matchAll(/constraint[:\s]+(.+?)(?:\n|$)/gi);
    return Array.from(matches).map((m) => m[1]?.trim() ?? '').filter(Boolean);
  }

  private _extractAcceptanceCriteria(text: string): string[] {
    const matches = text.matchAll(/(?:criteria|requirement)[:\s]+(.+?)(?:\n|$)/gi);
    return Array.from(matches).map((m) => m[1]?.trim() ?? '').filter(Boolean);
  }

  private _extractOntologyFields(text: string): OntologyField[] {
    // Extract capitalized compound terms as ontology candidates
    const words = text.toLowerCase().split(/[^a-z0-9_]+/);
    const freq: Record<string, number> = {};
    for (const word of words) {
      if (word.length > 4) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }
    const topTerms = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    return topTerms.map((name) => ({
      name,
      type: 'string',
      description: `Auto-extracted concept: ${name}`,
      required: false,
    }));
  }

  deserialize(data: Record<string, unknown>): void {
    if (data['seedSpec']) this._seedSpec = data['seedSpec'] as SeedSpec;
    if (data['driftMetrics']) this._driftMetrics = data['driftMetrics'] as DriftMetrics;
    if (data['stagnationHistory'])
      this._stagnationHistory = data['stagnationHistory'] as StagnationHistoryEntry[];
    if (data['evaluationPlan']) this._evaluationPlan = data['evaluationPlan'] as EvaluationPlan;
    if (data['lateralThinking']) this._lateralThinking = data['lateralThinking'] as LateralThinkingResult;
    if (data['interviewState']) this._interviewState = data['interviewState'] as InterviewState;
  }
}
