import { describe, expect, it } from 'vitest';
import {
  UltraPlanModeEngine,
  combinedDrift,
  isDriftAcceptable,
} from '../../src/agent/plan/ultra-plan-mode';

// Minimal mock agent
const mockAgent = {} as any;

describe('UltraPlanModeEngine', () => {
  describe('Seed Spec', () => {
    it('should generate a seed spec from interview data', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const seed = engine.generateSeedSpecFromInterview(
        'Build a CLI tool',
        ['Python 3.12+', 'No external DB'],
        ['Can create tasks', 'Can list tasks'],
        'TaskManager',
        [
          { name: 'tasks', type: 'array', description: 'List of tasks', required: true },
        ],
      );

      expect(seed.goal).toBe('Build a CLI tool');
      expect(seed.taskType).toBe('code');
      expect(seed.constraints).toHaveLength(2);
      expect(seed.acceptanceCriteria).toHaveLength(2);
      expect(seed.ontology.name).toBe('TaskManager');
      expect(seed.ontology.fields).toHaveLength(1);
      expect(seed.evaluationPrinciples).toHaveLength(3);
      expect(seed.exitConditions).toHaveLength(1);
      expect(seed.ambiguityScore).toBe(0.15);
    });

    it('should set and get seed spec', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const seed = engine.generateSeedSpecFromInterview('Test', [], [], 'TestOnto', []);
      engine.setSeedSpec(seed);
      expect(engine.seedSpec).toBe(seed);
    });
  });

  describe('Drift Detection', () => {
    it('should calculate drift when no seed spec exists', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const drift = engine.calculateDrift('some output', []);
      expect(drift.goalDrift).toBe(0);
      expect(drift.constraintDrift).toBe(0);
      expect(drift.ontologyDrift).toBe(0);
    });

    it('should detect goal drift', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.setSeedSpec(
        engine.generateSeedSpecFromInterview(
          'build a fast api',
          [],
          [],
          'API',
          [{ name: 'endpoints', type: 'array', description: 'API endpoints', required: true }],
        ),
      );
      const drift = engine.calculateDrift('build a slow database', []);
      expect(drift.goalDrift).toBeGreaterThan(0);
      expect(drift.goalDrift).toBeLessThanOrEqual(1);
    });

    it('should calculate constraint drift', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.setSeedSpec(
        engine.generateSeedSpecFromInterview('test', [], [], 'Test', []),
      );
      const drift = engine.calculateDrift('output', ['violation1', 'violation2']);
      expect(drift.constraintDrift).toBe(0.2);
    });

    it('should cap constraint drift at 1.0', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.setSeedSpec(
        engine.generateSeedSpecFromInterview('test', [], [], 'Test', []),
      );
      const drift = engine.calculateDrift('output', Array(20).fill('v'));
      expect(drift.constraintDrift).toBe(1.0);
    });
  });

  describe('Drift Utilities', () => {
    it('should calculate combined drift', () => {
      const metrics = { goalDrift: 0.2, constraintDrift: 0.1, ontologyDrift: 0.5 };
      expect(combinedDrift(metrics)).toBe(0.2 * 0.5 + 0.1 * 0.3 + 0.5 * 0.2);
    });

    it('should determine acceptable drift', () => {
      expect(isDriftAcceptable({ goalDrift: 0, constraintDrift: 0, ontologyDrift: 0 })).toBe(true);
      expect(isDriftAcceptable({ goalDrift: 1, constraintDrift: 0, ontologyDrift: 0 })).toBe(false);
    });
  });

  describe('Stagnation Detection', () => {
    it('should detect spinning', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const results = engine.detectStagnation(
        ['a', 'b', 'c'],
        ['error1', 'error1', 'error1'],
        [0.1, 0.1, 0.1],
      );
      const spinning = results.find((r) => r.pattern === 'spinning');
      expect(spinning).toBeDefined();
      expect(spinning!.detected).toBe(true);
      expect(spinning!.confidence).toBe(0.9);
    });

    it('should detect oscillation', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const results = engine.detectStagnation(
        ['a', 'b', 'a', 'b'],
        [],
        [0.1, 0.1, 0.1, 0.1],
      );
      const oscillation = results.find((r) => r.pattern === 'oscillation');
      expect(oscillation).toBeDefined();
      expect(oscillation!.detected).toBe(true);
      expect(oscillation!.confidence).toBe(0.85);
    });

    it('should detect no drift', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const results = engine.detectStagnation(
        ['a', 'b', 'c'],
        [],
        [0.1, 0.1, 0.1],
      );
      const noDrift = results.find((r) => r.pattern === 'no_drift');
      expect(noDrift).toBeDefined();
      expect(noDrift!.detected).toBe(true);
      expect(noDrift!.confidence).toBe(0.8);
    });

    it('should detect diminishing returns', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const results = engine.detectStagnation(
        ['a', 'b', 'c', 'd'],
        [],
        [0.1, 0.1001, 0.1002, 0.1003],
      );
      const diminishing = results.find((r) => r.pattern === 'diminishing_returns');
      expect(diminishing).toBeDefined();
      expect(diminishing!.detected).toBe(true);
      expect(diminishing!.confidence).toBe(0.75);
    });

    it('should not detect patterns with insufficient data', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const results = engine.detectStagnation(['a'], ['e1'], [0.1]);
      expect(results.every((r) => !r.detected)).toBe(true);
    });
  });

  describe('Lateral Thinking', () => {
    it('should generate lateral thinking for each persona', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const personas = ['hacker', 'researcher', 'simplifier', 'architect', 'contrarian'] as const;

      for (const persona of personas) {
        const result = engine.generateLateralThinking(persona, 'problem', 'current approach');
        expect(result.persona).toBe(persona);
        expect(result.prompt).toContain(persona);
        expect(result.questions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Evaluation Plan', () => {
    it('should generate default evaluation plan', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const plan = engine.generateDefaultEvaluationPlan();
      expect(plan.stage1Mechanical).toBe(true);
      expect(plan.stage2Semantic).toBe(true);
      expect(plan.stage3Consensus).toBe(false);
      expect(plan.mechanicalChecks).toContain('lint');
      expect(plan.semanticCriteria).toContain('ac_compliance');
    });

    it('should set and get evaluation plan', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const plan = engine.generateDefaultEvaluationPlan();
      engine.setEvaluationPlan(plan);
      expect(engine.evaluationPlan).toBe(plan);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      const seed = engine.generateSeedSpecFromInterview('test', [], [], 'Test', []);
      engine.setSeedSpec(seed);
      engine.setEvaluationPlan(engine.generateDefaultEvaluationPlan());

      const serialized = engine.serialize();
      expect(serialized.seedSpec).toBeDefined();
      expect(serialized.evaluationPlan).toBeDefined();

      const newEngine = new UltraPlanModeEngine(mockAgent);
      newEngine.deserialize(serialized);
      expect(newEngine.seedSpec).toEqual(seed);
      expect(newEngine.evaluationPlan).toEqual(engine.evaluationPlan);
    });
  });
});
