import { describe, expect, it } from 'vitest';
import {
  UltraPlanModeEngine,
  combinedDrift,
  isDriftAcceptable,
} from '../../src/agent/plan/ultra-plan-mode';

// Minimal mock agent
const mockAgent = {
  context: {
    history: [],
  },
} as any;

function mockAgentWithUserPrompt(prompt: string): any {
  return {
    context: {
      history: [
        {
          role: 'user',
          origin: { kind: 'user' },
          content: [{ type: 'text', text: prompt }],
          toolCalls: [],
        },
      ],
    },
  };
}

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

    it('reopens interview for seed refinement after drift blocks exit', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.startInterview('Build a verifiable CLI fix');
      const seed = engine.generateSeedSpecFromInterview('Build a verifiable CLI fix', [], [], 'CLI', []);
      engine.setSeedSpec(seed);

      engine.addInterviewRound(
        'Confirm the seed.',
        'Goal: build a verifiable CLI fix. Actors: user and agent. Inputs: repo files. Outputs: source edits. Constraints: no unrelated changes. Non-goals: no broad refactor. Acceptance Criteria: tests pass. Verification Plan: run tests. Failure Modes: regression. Runtime Context: TypeScript repo. Completion Criterion: true when tests pass, false otherwise.',
      );
      engine.calculateAmbiguityScore();

      engine.reopenInterviewForSeedRefinement({
        goalDrift: 0.9,
        constraintDrift: 0,
        ontologyDrift: 0.6,
      });

      expect(engine.seedSpec).toBeNull();
      expect(engine.interviewState.ambiguityScore).toBeNull();
      expect(engine.interviewState.completionCandidateStreak).toBe(0);
      expect(engine.interviewState.lastReadyEvidenceHash).toBeUndefined();
    });
  });

  describe('Interview ambiguity scoring', () => {
    it('accumulates interview Q/A into ambiguity scoring and completion readiness', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.startInterview('Build SuperLiora premium Ultrawork regression protection');

      const initial = engine.calculateAmbiguityScore();
      expect(initial.milestone).toBe('initial');
      expect(initial.isReadyForSeed).toBe(false);
      expect(engine.interviewState.ambiguityScore).toEqual(initial);

      engine.addInterviewRound(
        'What is the goal and scope?',
        'Goal: preserve the SuperLiora premium CLI workflow with a verifiable UltraGoal. Actors: CLI user, TUI agent, verification owner. Scope: TUI help, theme, UltraPlan, UltraGoal, Research, Swarm decision, and Verify surfaces.',
      );
      engine.addInterviewRound(
        'What constraints and risks must be protected?',
        'Inputs: current repository files, TUI prompt, tests, and user request. Outputs: patched TUI flow, updated tests, and verification evidence. Constraints: must keep the Ultrawork brand visible, cannot hide advanced commands, and should avoid unrelated refactors. Non-goals: do not redesign unrelated provider setup or rewrite the whole TUI. Failure modes: regression that removes terminal themes, weakens slash command access, or claims Swarm without a decision.',
      );
      engine.addInterviewRound(
        'What acceptance criteria should verify success?',
        'Acceptance Criteria: /help advanced shows Ultra access paths, /theme lists bundled themes, /plan ultra starts UltraPlan, /ultrawork connects the workflow, and tests verify each requirement. Verification Plan: run unit tests and inspect rendered TUI copy. Runtime Context: TypeScript monorepo in a local CLI workspace. Completion Criterion: true when tests pass and the workflow is visibly complete, false otherwise.',
      );

      const scored = engine.calculateAmbiguityScore();

      expect(engine.interviewState.rounds).toMatchObject([
        { roundNumber: 1, question: 'What is the goal and scope?' },
        { roundNumber: 2, question: 'What constraints and risks must be protected?' },
        { roundNumber: 3, question: 'What acceptance criteria should verify success?' },
      ]);
      expect(scored.overallScore).toBeLessThan(initial.overallScore);
      expect(scored.milestone).toBe('ready');
      expect(scored.isReadyForSeed).toBe(true);
      expect(engine.interviewState.ambiguityScore).toEqual(scored);
      expect(engine.interviewState.completionCandidateStreak).toBe(1);
      expect(engine.canAutoComplete()).toBe(false);

      engine.addInterviewRound(
        'Confirm the Seed is complete without changing scope.',
        'Confirmed: the Seed is complete. Completion Criterion remains true when tests pass and the workflow is visibly complete, false otherwise. No extra scope is added.',
      );
      engine.calculateAmbiguityScore();

      expect(engine.interviewState.completionCandidateStreak).toBe(2);
      expect(engine.canAutoComplete()).toBe(true);
    });

    it('keeps interview blocked until every required seed ledger gap is closed', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.startInterview('Implement a guarded Ultrawork mode');

      engine.addInterviewRound(
        'What is the goal?',
        'Goal: implement a verifiable UltraGoal that is true when Shift-Tab starts Ultrawork and false otherwise. Acceptance Criteria: status and footer tests pass. Verification Plan: run the focused TUI tests.',
      );

      const readiness = engine.interviewReadiness();

      expect(readiness.ready).toBe(false);
      expect(readiness.verifiableGoal).toBe(true);
      expect(readiness.openGaps).toContain('actors');
      expect(readiness.openGaps).toContain('inputs');
      expect(readiness.openGaps).toContain('runtime_context');
      expect(readiness.ambiguityScore.overallScore).toBeGreaterThan(0.2);
      expect(engine.readinessBlockerMessage()).toContain('open_gaps=');
    });

    it('does not close seed gaps from section labels in the question text alone', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.startInterview('Make a game');

      engine.addInterviewRound(
        'Please answer Goal, Actors, Inputs, Outputs, Constraints, Non-goals, Acceptance Criteria, Verification Plan, Failure Modes, and Runtime Context.',
        'yes',
      );

      const readiness = engine.interviewReadiness();

      expect(readiness.ready).toBe(false);
      expect(readiness.openGaps).toContain('actors');
      expect(readiness.openGaps).toContain('acceptance_criteria');
      expect(readiness.ambiguityScore.overallScore).toBeGreaterThan(0.2);
    });

    it('increments completion streak on a new ready round even when evidence hash collides', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.startInterview('Build SuperLiora premium Ultrawork regression protection');

      engine.addInterviewRound(
        'What is the goal and scope?',
        'Goal: preserve the SuperLiora premium CLI workflow with a verifiable UltraGoal. Actors: CLI user, TUI agent, verification owner. Scope: TUI help, theme, UltraPlan, UltraGoal, Research, Swarm decision, and Verify surfaces.',
      );
      engine.addInterviewRound(
        'What constraints and risks must be protected?',
        'Inputs: current repository files, TUI prompt, tests, and user request. Outputs: patched TUI flow, updated tests, and verification evidence. Constraints: must keep the Ultrawork brand visible, cannot hide advanced commands, and should avoid unrelated refactors. Non-goals: do not redesign unrelated provider setup or rewrite the whole TUI. Failure modes: regression that removes terminal themes, weakens slash command access, or claims Swarm without a decision.',
      );
      engine.addInterviewRound(
        'What acceptance criteria should verify success?',
        'Acceptance Criteria: /help advanced shows Ultra access paths, /theme lists bundled themes, /plan ultra starts UltraPlan, /ultrawork connects the workflow, and tests verify each requirement. Verification Plan: run unit tests and inspect rendered TUI copy. Runtime Context: TypeScript monorepo in a local CLI workspace. Completion Criterion: true when tests pass and the workflow is visibly complete, false otherwise.',
      );
      engine.calculateAmbiguityScore();
      expect(engine.interviewState.completionCandidateStreak).toBe(1);
      expect(engine.canAutoComplete()).toBe(false);

      // Simulate a hash collision: all evidence hashes look identical, so the old
      // evidence-hash-only check would never count the second ready round.
      (engine as any)._hash = () => 'collision';

      engine.addInterviewRound(
        'Confirm the Seed is complete without changing scope.',
        'Confirmed: the Seed is complete. Completion Criterion remains true when tests pass and the workflow is visibly complete, false otherwise. No extra scope is added.',
      );
      engine.calculateAmbiguityScore();

      expect(engine.interviewState.completionCandidateStreak).toBe(2);
      expect(engine.canAutoComplete()).toBe(true);
    });

    it('uses the current user prompt as interview context for already-bounded tasks', () => {
      const engine = new UltraPlanModeEngine(mockAgentWithUserPrompt([
        'Use Ultrawork for this bounded source/test verification task.',
        'You are the implementation agent and verification owner.',
        'Task: edit apps/liora/src/tui/commands/ultrawork-contract.ts and apps/liora/test/tui/commands/ultrawork.test.ts.',
        'Inputs: the named source file, test file, and prompt.',
        'Outputs: add SUPER_KIMI_REAL_WORKFLOW_EVIDENCE and report concise evidence.',
        'Constraints: do not edit the harness verifier and make no other changes.',
        'Non-goals: no broad refactor and no unrelated provider changes.',
        'Acceptance Criteria: the check script and targeted test pass.',
        'Verification Plan: run node .super-kimi-real-workflow/check.mjs and the targeted vitest command.',
        'Failure Modes: wrong file edited, verifier edited, or tests fail.',
        'Runtime Context: disposable repository worktree.',
        'Completion Criterion: true when both verification commands pass, false otherwise.',
      ].join('\n')));
      engine.startInterview('');

      const readiness = engine.interviewReadiness();

      expect(readiness.ready).toBe(true);
      expect(readiness.openGaps).toEqual([]);
      expect(readiness.verifiableGoal).toBe(true);
      expect(readiness.ambiguityScore.overallScore).toBeLessThanOrEqual(0.2);
      expect(readiness.stableReady).toBe(false);
      expect(readiness.completionCandidateStreak).toBe(1);
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

    it('should keep goal drift low when a detailed plan reflects the seed terms', () => {
      const engine = new UltraPlanModeEngine(mockAgent);
      engine.setSeedSpec(
        engine.generateSeedSpecFromInterview(
          'build a fast api',
          ['use TypeScript', 'add unit tests'],
          ['endpoint latency under 100ms', 'passing test suite'],
          'API',
          [{ name: 'endpoints', type: 'array', description: 'API endpoints', required: true }],
        ),
      );
      const detailedPlan = `
# Execution Plan

## Overview
We will build a fast api service using TypeScript. The implementation must add unit tests
for every endpoint and keep endpoint latency under 100ms. The passing test suite will be
verified in CI. Additional details about deployment, monitoring, and documentation are
included here only to make the plan longer and must not inflate the drift score.
      `.trim();
      const drift = engine.calculateDrift(detailedPlan, []);
      expect(drift.goalDrift).toBeLessThanOrEqual(0.3);
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
      const drift = engine.calculateDrift('output', Array.from({ length: 20 }, () => 'v'));
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
      expect(serialized['seedSpec']).toBeDefined();
      expect(serialized['evaluationPlan']).toBeDefined();

      const newEngine = new UltraPlanModeEngine(mockAgent);
      newEngine.deserialize(serialized);
      expect(newEngine.seedSpec).toEqual(seed);
      expect(newEngine.evaluationPlan).toEqual(engine.evaluationPlan);
    });
  });
});
