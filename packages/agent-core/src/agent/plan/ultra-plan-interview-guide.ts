/**
 * Pure interview readiness prompt helpers for Ultra Plan mode.
 * No engine state — only readiness snapshots and section guidance.
 */

import { AMBIGUITY_THRESHOLD } from './ultra-plan-ambiguity-heuristic';
import {
  MAX_INTERVIEW_ROUNDS,
  ULTRA_PLAN_SECTION_GUIDANCE,
  type UltraPlanRequiredSection,
} from './ultra-plan-section-guidance';
import type { InterviewPerspective, UltraPlanReadiness } from './ultra-plan-mode';

export interface InterviewReadinessGuideOptions {
  readonly perspective?: InterviewPerspective;
  readonly interviewRoundCount?: number;
  readonly consecutiveNonUserAnswers?: number;
  /** Sparse injectors: one-line status + next focus (no full gap catalog). */
  readonly compact?: boolean;
}

export function pickNextInterviewFocus(
  readiness: UltraPlanReadiness,
  perspective: InterviewPerspective = 'researcher',
): string {
  const lens = perspectiveFocusLead(perspective);
  if (!readiness.verifiableGoal) {
    const completionAsk =
      perspective === 'seed-closer'
        ? 'how success is judged true/false or pass/fail with a concrete Completion Criterion'
        : 'how success is judged true/false or pass/fail — offer Baseline completion vs an Upgrade with a sharper verifiable test';
    return `${lens} Completion Criterion — ask ${completionAsk}.`;
  }
  const firstGap = readiness.openGaps[0];
  if (firstGap !== undefined) {
    const guidance = ULTRA_PLAN_SECTION_GUIDANCE[firstGap];
    return `${lens} ${guidance.label} — ${guidance.askHint}${perspectiveGapSuffix(perspective, firstGap)}`;
  }
  if (readiness.floorFailures.length > 0) {
    return `${lens} clarify ${readiness.floorFailures[0]} with concrete specifics (files, commands, metrics, deliverables).`;
  }
  return `${lens} clarify the vaguest remaining requirement with concrete specifics and Baseline/Upgrade options when they help.`;
}

function perspectiveFocusLead(perspective: InterviewPerspective): string {
  const leads: Record<InterviewPerspective, string> = {
    researcher: 'Researcher lens — cite context/benchmarks, then',
    simplifier: 'Simplifier lens — Baseline MVP vs Upgrade, then',
    architect: 'Architect lens — structure/interfaces/maintainability, then',
    'breadth-keeper': 'Breadth-keeper lens — stretch vs non-goals, then',
    'seed-closer': 'Seed-closer lens — measurable criteria, then',
  };
  return leads[perspective];
}

function perspectiveGapSuffix(
  perspective: InterviewPerspective,
  gap: UltraPlanRequiredSection,
): string {
  const suffixes: Partial<Record<InterviewPerspective, Partial<Record<UltraPlanRequiredSection, string>>>> = {
    researcher: {
      goal: ' Ground options in industry patterns or benchmarks when useful.',
      constraints: ' Reference comparable projects or standards when useful.',
      runtime_context: ' Mention stack norms or deployment patterns when useful.',
    },
    simplifier: {
      goal: ' Offer Baseline (minimal) vs Upgrade (higher payoff) scope.',
      non_goals: ' Show what to defer without losing the core outcome.',
      acceptance_criteria: ' Separate must-have checks from nice-to-have upgrades.',
    },
    architect: {
      actors: ' Clarify who owns interfaces, reviews, and long-term maintenance.',
      inputs: ' Name the structural boundaries the work starts from.',
      outputs: ' Name durable artifacts (modules, APIs, schemas) not just tasks.',
    },
    'breadth-keeper': {
      non_goals: ' Catch scope creep and missing edge cases.',
      failure_modes: ' Surface regressions and quality dimensions the user skipped.',
      acceptance_criteria: ' Add stretch checks only when they materially improve outcomes.',
    },
    'seed-closer': {
      acceptance_criteria: ' Make each criterion pass/fail or measurable.',
      verification_plan: ' Name exact commands, reviews, or demos.',
      goal: ' Lock a true/false Completion Criterion before advancing.',
    },
  };
  return suffixes[perspective]?.[gap] ?? ' Offer Baseline + Upgrade when the choice changes outcomes.';
}

export function formatInterviewReadinessGuide(
  readiness: UltraPlanReadiness,
  options?: InterviewReadinessGuideOptions,
): string {
  const perspective = options?.perspective ?? 'researcher';
  const interviewRoundCount = options?.interviewRoundCount ?? 0;
  if (readiness.ready) {
    const softNotes: string[] = [];
    if (readiness.openGaps.length > 0) {
      softNotes.push(
        `Soft seed recommendations (not Design blockers): open_gaps=${readiness.openGaps.join(', ')}`,
      );
    }
    if (readiness.floorFailures.length > 0) {
      softNotes.push(
        `Soft clarity floors (not Design blockers): ${readiness.floorFailures.join('; ')}`,
      );
    }
    if (
      readiness.openGaps.length === 0 &&
      readiness.floorFailures.length === 0 &&
      !readiness.ambiguityScore.isReadyForSeed
    ) {
      softNotes.push('Soft seed completeness still improving — Design hard gate already passes.');
    }
    return [
      'Interview readiness: READY for Design (verifiable UltraGoal). Call NextPhase({ phase: "design" }). Seed Spec auto-extracts from interview evidence.',
      ...softNotes,
      'Do not Write or Edit the plan file yet — that happens in Write phase.',
    ].join('\n');
  }

  if (options?.compact === true) {
    const focus = pickNextInterviewFocus(readiness, perspective);
    const gaps =
      readiness.openGaps.length === 0 ? 'none' : readiness.openGaps.slice(0, 4).join(', ');
    const more =
      readiness.openGaps.length > 4 ? `+${readiness.openGaps.length - 4}` : '';
    const rhythm =
      (options.consecutiveNonUserAnswers ?? 0) >= 3
        ? ' | RHYTHM: AskUserQuestion next'
        : '';
    return [
      `Interview readiness: NOT READY | ambiguity=${readiness.ambiguityScore.overallScore.toFixed(2)} | verifiable_goal=${readiness.verifiableGoal ? 'true' : 'false'} | open_gaps=${gaps}${more}${rhythm}`,
      `NEXT: ${focus}`,
      'No plan Write/Edit. Hard blocker: non-verifiable UltraGoal — soft seed gaps are recommendations only.',
    ].join('\n');
  }

  const lines: string[] = [
    'Interview readiness: NOT READY for Design.',
    'Hard blocker (must close before NextPhase):',
  ];

  if (readiness.usedHeuristicFallback) {
    lines.push('⚠ Scoring fallback (heuristic); continue or rescore later.');
  }

  lines.push('1. verifiable_goal=false — capture a true/false Completion Criterion.');

  // Soft seed guidance — never framed as Design hard blockers.
  const soft: string[] = [];
  if (readiness.openGaps.length > 0) {
    soft.push(`open_gaps (${readiness.openGaps.length}): ${readiness.openGaps.join(', ')}`);
    for (const gap of readiness.openGaps.slice(0, 3)) {
      const guidance = ULTRA_PLAN_SECTION_GUIDANCE[gap];
      soft.push(`   - ${guidance.label}: ${guidance.askHint}`);
    }
    if (readiness.openGaps.length > 3) {
      soft.push(`   - …+${readiness.openGaps.length - 3} more`);
    }
  }
  if (readiness.floorFailures.length > 0) {
    soft.push(
      `clarity floors: ${readiness.floorFailures.join('; ')} — ask for files/commands/metrics.`,
    );
  }
  if (readiness.ambiguityScore.overallScore > AMBIGUITY_THRESHOLD) {
    soft.push(
      `ambiguity=${readiness.ambiguityScore.overallScore.toFixed(3)} (seed guidance <= ${AMBIGUITY_THRESHOLD.toFixed(1)}; not a Design hard gate)`,
    );
  }
  if (soft.length > 0) {
    lines.push('Soft seed recommendations (not Design blockers):');
    lines.push(...soft);
  }

  if (interviewRoundCount >= MAX_INTERVIEW_ROUNDS) {
    lines.push(
      `Round cap: ${interviewRoundCount}/${MAX_INTERVIEW_ROUNDS} (soft). advance_with_defaults may soft-fill seed gaps only after UltraGoal is verifiable — it never bypasses a non-verifiable goal. Keep interviewing for a true/false Completion Criterion, or call NextPhase({ phase: "design", advance_with_defaults: true }) once verifiable.`,
    );
  }

  const consecutiveNonUser = options?.consecutiveNonUserAnswers ?? 0;
  if (consecutiveNonUser > 0 && consecutiveNonUser < 3) {
    lines.push(`Auto-answers: ${consecutiveNonUser}/3.`);
  }
  if (consecutiveNonUser >= 3) {
    lines.push('⚠ RHYTHM GUARD: 3 non-user findings — next turn MUST AskUserQuestion (PATH 2).');
  }

  lines.push(
    `Status: perspective=${perspective} | ambiguity=${readiness.ambiguityScore.overallScore.toFixed(3)} | verifiable_goal=${readiness.verifiableGoal ? 'true' : 'false'} | open_gaps=${readiness.openGaps.length === 0 ? 'none' : readiness.openGaps.join(', ')}`,
    'Do not Write or Edit the plan file. No NextPhase until UltraGoal is verifiable. Soft seed gaps are recommendations — target them via Baseline/Upgrade when helpful.',
    `NEXT TURN — AskUserQuestion through the ${perspective} perspective (one gap):`,
    pickNextInterviewFocus(readiness, perspective),
  );

  const lateralHint = perspectiveLateralHint(perspective);
  if (lateralHint !== undefined) {
    lines.push(`Lateral (${perspective}): ${lateralHint}`);
  }

  return lines.join('\n');
}

function perspectiveLateralHint(perspective: InterviewPerspective): string | undefined {
  const hints: Partial<Record<InterviewPerspective, string>> = {
    researcher: 'Missing info or prior art?',
    simplifier: 'What Baseline cut removes 30%+ scope?',
    architect: 'Which abstraction clarifies structure?',
    'breadth-keeper': 'Missed edge cases vs non-goals?',
    'seed-closer': 'What fails the goal? Lock pass/fail ACs.',
  };
  return hints[perspective];
}
