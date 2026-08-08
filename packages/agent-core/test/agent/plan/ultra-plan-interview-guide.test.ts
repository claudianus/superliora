import { describe, expect, it } from 'vitest';

import {
  formatInterviewReadinessGuide,
  pickNextInterviewFocus,
} from '#/agent/plan/ultra-plan-interview-guide';
import { ULTRA_PLAN_REQUIRED_SECTIONS } from '#/agent/plan/ultra-plan-section-guidance';
import type {
  AmbiguityScoreResult,
  InterviewPerspective,
  UltraPlanReadiness,
} from '#/agent/plan/ultra-plan-mode';

const baseAmbiguity = (over: Partial<AmbiguityScoreResult> = {}): AmbiguityScoreResult => ({
  overallScore: 0,
  breakdown: [],
  isReadyForSeed: true,
  milestone: 'ready',
  floorFailures: [],
  usedHeuristicFallback: false,
  ...over,
});

const makeReadiness = (over: Partial<UltraPlanReadiness> = {}): UltraPlanReadiness => ({
  ready: false,
  verifiableGoal: false,
  openGaps: [],
  floorFailures: [],
  usedHeuristicFallback: false,
  ambiguityScore: baseAmbiguity(),
  ...over,
});

describe('ultra-plan-interview-guide — pickNextInterviewFocus', () => {
  it('targets Completion Criterion when UltraGoal is not verifiable (researcher default)', () => {
    const out = pickNextInterviewFocus(makeReadiness({ verifiableGoal: false }));
    expect(out).toContain('Researcher lens');
    expect(out).toContain('Completion Criterion');
    expect(out).toContain('Baseline completion vs an Upgrade');
  });

  it('uses seed-closer phrasing when UltraGoal is not verifiable and perspective=seed-closer', () => {
    const out = pickNextInterviewFocus(makeReadiness({ verifiableGoal: false }), 'seed-closer');
    expect(out).toContain('Seed-closer lens');
    expect(out).toContain('Completion Criterion');
    expect(out).toContain('how success is judged');
  });

  it('targets the first open gap and uses the section guidance askHint', () => {
    const first = ULTRA_PLAN_REQUIRED_SECTIONS[0];
    const out = pickNextInterviewFocus(
      makeReadiness({ verifiableGoal: true, openGaps: [first] }),
      'simplifier',
    );
    expect(out).toContain('Goal');
    expect(out).toContain('Offer Baseline (minimal) vs Upgrade (higher payoff) scope.');
  });

  it('falls back to the generic "Baseline + Upgrade" suffix for sections without a perspective-specific note', () => {
    // Pick a perspective/section combination that does not have a per-perspective entry.
    const out = pickNextInterviewFocus(
      makeReadiness({ verifiableGoal: true, openGaps: ['verification_plan'] }),
      'breadth-keeper',
    );
    expect(out).toContain('Verification Plan');
    expect(out).toMatch(/Offer Baseline \+ Upgrade/);
  });

  it('falls back to clarifying the first floor failure when no gap is open', () => {
    const out = pickNextInterviewFocus(
      makeReadiness({
        verifiableGoal: true,
        openGaps: [],
        floorFailures: ['goal_clarity'],
      }),
    );
    expect(out).toContain('clarify goal_clarity');
  });

  it('falls back to a generic "vague requirement" prompt when nothing is missing', () => {
    const out = pickNextInterviewFocus(
      makeReadiness({ verifiableGoal: true, openGaps: [], floorFailures: [] }),
    );
    expect(out).toContain('clarify the vaguest remaining requirement');
  });
});

describe('ultra-plan-interview-guide — formatInterviewReadinessGuide', () => {
  it('renders the READY line plus the soft-notes when everything is in order', () => {
    const out = formatInterviewReadinessGuide(makeReadiness({ ready: true }));
    expect(out).toContain('Interview readiness: READY for Design');
    expect(out).toContain('Call NextPhase({ phase: "design" })');
    expect(out).toContain('Do not Write or Edit the plan file yet');
  });

  it('emits the "soft seed recommendations" line for open gaps when ready', () => {
    const out = formatInterviewReadinessGuide(
      makeReadiness({ ready: true, openGaps: ['goal', 'actors'] }),
    );
    expect(out).toContain('open_gaps=goal, actors');
  });

  it('emits the "soft clarity floors" line for floor failures when ready', () => {
    const out = formatInterviewReadinessGuide(
      makeReadiness({ ready: true, floorFailures: ['goal_clarity'] }),
    );
    expect(out).toContain('Soft clarity floors');
    expect(out).toContain('goal_clarity');
  });

  it('emits the "soft seed completeness still improving" line when soft seed is incomplete', () => {
    const out = formatInterviewReadinessGuide(
      makeReadiness({
        ready: true,
        ambiguityScore: baseAmbiguity({ isReadyForSeed: false }),
      }),
    );
    expect(out).toContain('Soft seed completeness still improving');
  });

  it('emits the compact "NOT READY" header with +N more and rhythm guard', () => {
    const readiness = makeReadiness({
      ready: false,
      verifiableGoal: false,
      openGaps: ['goal', 'actors', 'inputs', 'outputs', 'constraints'],
    });
    const out = formatInterviewReadinessGuide(readiness, {
      compact: true,
      consecutiveNonUserAnswers: 3,
    });
    expect(out).toContain('Interview readiness: NOT READY');
    expect(out).toContain('+1');
    expect(out).toContain('RHYTHM: AskUserQuestion next');
    expect(out).toContain('NEXT:');
  });

  it('renders the full NOT READY line with hard blocker, soft notes, and lateral hint', () => {
    const readiness = makeReadiness({
      ready: false,
      verifiableGoal: false,
      openGaps: ['goal', 'actors', 'inputs', 'outputs'],
      floorFailures: ['goal_clarity'],
      usedHeuristicFallback: true,
      ambiguityScore: baseAmbiguity({ overallScore: 0.6 }),
    });
    const out = formatInterviewReadinessGuide(readiness, {
      perspective: 'architect',
      interviewRoundCount: 99,
    });
    expect(out).toContain('Interview readiness: NOT READY for Design');
    expect(out).toContain('Scoring fallback (heuristic)');
    expect(out).toContain('verifiable_goal=false');
    expect(out).toContain('+1 more');
    expect(out).toContain('clarity floors: goal_clarity');
    expect(out).toContain('Round cap: 99/');
    expect(out).toContain('close one open gap through the architect lens');
    expect(out).toContain('AskUserQuestion only for human judgment');
    expect(out).toContain('Lateral (architect): Which abstraction clarifies structure?');
  });

  it('emits the rhythm guard warning when non-user answers are >= 3', () => {
    const out = formatInterviewReadinessGuide(
      makeReadiness({ ready: false, verifiableGoal: false }),
      { consecutiveNonUserAnswers: 3 },
    );
    expect(out).toContain('RHYTHM GUARD');
    expect(out).toContain('AskUserQuestion');
  });

  it('emits the auto-answers counter when 1..2 non-user answers were seen', () => {
    const out = formatInterviewReadinessGuide(
      makeReadiness({ ready: false, verifiableGoal: false }),
      { consecutiveNonUserAnswers: 2 },
    );
    expect(out).toContain('Auto-answers: 2/3.');
  });

  it('renders the "perspective status" footer in the full NOT READY path', () => {
    const out = formatInterviewReadinessGuide(
      makeReadiness({ ready: false, verifiableGoal: false }),
      { perspective: 'simplifier' satisfies InterviewPerspective },
    );
    expect(out).toContain('perspective=simplifier');
  });
});
