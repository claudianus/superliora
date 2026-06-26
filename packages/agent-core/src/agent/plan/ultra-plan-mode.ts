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

import type { Agent } from '..';

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

export function combinedDrift(metrics: DriftMetrics): number {
  return metrics.goalDrift * 0.5 + metrics.constraintDrift * 0.3 + metrics.ontologyDrift * 0.2;
}

export function isDriftAcceptable(metrics: DriftMetrics): boolean {
  return combinedDrift(metrics) <= 0.3;
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

  get seedSpec(): SeedSpec | null {
    return this._seedSpec;
  }

  generateSeedSpecFromInterview(
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
    const goalWords = this._tokenize(this._seedSpec.goal);
    const outputWords = this._tokenize(currentOutput);
    if (!goalWords.size || !outputWords.size) return 1.0;
    const intersection = new Set([...goalWords].filter((x) => outputWords.has(x)));
    const union = new Set([...goalWords, ...outputWords]);
    const similarity = intersection.size / union.size;
    return 1.0 - similarity;
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
      improvements.push(driftScores[i] - driftScores[i - 1]);
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
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return String(h);
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

  deserialize(data: Record<string, unknown>): void {
    if (data.seedSpec) this._seedSpec = data.seedSpec as SeedSpec;
    if (data.driftMetrics) this._driftMetrics = data.driftMetrics as DriftMetrics;
    if (data.stagnationHistory)
      this._stagnationHistory = data.stagnationHistory as StagnationHistoryEntry[];
    if (data.evaluationPlan) this._evaluationPlan = data.evaluationPlan as EvaluationPlan;
    if (data.lateralThinking) this._lateralThinking = data.lateralThinking as LateralThinkingResult;
  }
}
