/**
 * Ultra Plan Mode phase reminder builders (dense control text; keep contract phrases).
 */

import type { PlanFilePath } from '../plan';
import type { Agent } from '..';
import { formatInterviewReadinessGuide } from '../plan/ultra-plan-mode';
import { LIBRARY_DOCS_RESEARCH_GUIDANCE } from '../../research/library-docs';
import { NO_AI_SLOP_SKILL_MANDATE_COMPACT } from '../../anti-slop/contract';

function withPlanFileFooter(body: string, planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) return body;
  return `${body}

Plan file: ${planFilePath}`;
}

/** Shared read-only research tool list (keeps names tests and model routing need). */
const ULTRA_PLAN_READ_TOOLS =
  'Context7Resolve, Context7Docs, WebSearch, FetchURL, RepoQuery, Read, Grep, Glob, ReadMediaFile, SearchSkill, Skill, SearchExpert, read-only Bash, TodoList progress tracking';

/** Harness-enforced plan-mode guards (true denies); everything else is guidance. */
const ULTRA_PLAN_RESEARCH_GUARDS =
  'Product Write/Edit BLOCKED by plan mode; CronCreate/CronDelete BLOCKED. TaskStop and ExitPlanMode follow your permission mode.';
const ULTRA_PLAN_INTERVIEW_GUARDS =
  'CronCreate/CronDelete BLOCKED. Product Write/Edit allowed for investigation prototypes under planMode; plan-file Write/Edit still deferred to Write phase (Seed Spec auto-extracts on Design). TaskStop and ExitPlanMode follow your permission mode.';

const PHASE_INSTRUCTIONS: Record<string, string> = {
  research: `## Research Phase
Allowed: ${ULTRA_PLAN_READ_TOOLS}, NextPhase, AskUserQuestion.
${ULTRA_PLAN_RESEARCH_GUARDS}

Goal: source-backed context + improvement levers before UltraPlan interview elevates goals.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}
Evidence-first: prefer RepoQuery, Grep, Glob before broad Read; cite concrete paths. Research is product-write read-only; defer plan-file writing to the Write phase (guidance).
Distill an evidence pack; do not ask the user.
Your turn MUST end with a short evidence-pack summary, then call NextPhase({ phase: 'interview' }).`,

  interview: `## Interview Phase (Ouroboros-aligned Socratic)
You are ONLY an interviewer/requirements engineer — never promise to implement. Crystallize vague asks into a Seed; stop when ambiguity ≤ 0.2 and UltraGoal is true/false-verifiable.

Allowed: ${ULTRA_PLAN_READ_TOOLS}, AskUserQuestion, RecordInterviewFinding, NextPhase, product Write/Edit for investigation prototypes.
${ULTRA_PLAN_INTERVIEW_GUARDS}

Provenance (same spirit as [from-code]/[from-user]/[from-research]):
- PATH 1 code/config facts → RecordInterviewFinding(origin="code") — do not re-ask the user.
- PATH 2 human judgment (goal, acceptance, trade-offs, scope) → AskUserQuestion.
- PATH 3 external facts → research first, RecordInterviewFinding(origin="research"); confirm surprises with the user.
- After 3 consecutive non-user findings → must AskUserQuestion. Prefer RepoQuery/Grep/Glob before broad Read; Context7 for library APIs; WebSearch/FetchURL for external facts.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}

Question quality:
- Ontological: "What IS this?", assumptions, root vs symptom — 1–2 focused questions per turn.
- Baseline + 1–3 Upgrades (payoff/trade-off) + Defer/minimal when the choice locks the UltraGoal.
- Breadth: if one file/bug dominated 2+ rounds, zoom out to unresolved tracks before drilling deeper.
- High-context / prior notes: first turn may present a short numbered synthesis (confirmed / inferred / human-only) and ask which line is wrong — inverted correction, not blank-slate re-ask.
- Stop when scope, non-goals, outputs, and verification are explicit enough for a Seed — do not open another deep sub-question just to refine wording.

Hard gate for NextPhase: verifiable UltraGoal (complete/incomplete or pass/fail). Soft seed gaps do not block. Prefer NextPhase({ phase: 'write' }) once READY; use design only if architecture is still open. Do not call EnterPlanMode again.

Round {{round}} | Perspective: {{perspective}} — {{perspectiveDescription}} | ambiguity {{ambiguityScore}} | milestone {{milestone}} | next {{nextMilestone}}

Your turn MUST end with AskUserQuestion, RecordInterviewFinding, or NextPhase.`,

  design: `## Design Phase (optional)
Allowed: ${ULTRA_PLAN_READ_TOOLS}. Product Write/Edit BLOCKED by plan mode (plan-file Write/Edit allowed, but converge first); CronCreate/CronDelete BLOCKED.
Converge on one approach only if still open after interview. Prefer NextPhase({ phase: 'write' }); use review only when code verification is still needed.`,

  review: `## Review Phase (optional)
Allowed: ${ULTRA_PLAN_READ_TOOLS}, TaskList, TaskOutput. Product Write/Edit BLOCKED by plan mode; CronCreate/CronDelete BLOCKED.
Verify design against code when needed, then NextPhase({ phase: 'write' }).`,

  write: `## Write Phase
You may ONLY write to the current plan file. All other file edits BLOCKED. Reading (Read, Grep, Glob, RepoQuery, WebSearch, FetchURL) for quick verification — stay on the plan file. TodoList for progress; SearchSkill/Skill for no-AI-slop; NextPhase or ExitPlanMode when complete.

Before writing user-visible plan prose: ${NO_AI_SLOP_SKILL_MANDATE_COMPACT}
No-AI-Slop skill routing: SearchSkill with response language + surface keywords → Skill only if the light pass fails.

Write sections: Seed Spec, AC Tree, Swarm Decision, WorkGraph, Evaluation Plan, Execution Plan.
Include: \`Swarm decision: ENGAGE|ADAPTIVE|DEFER - <reason>; Swarm intensity: light|standard|heavy; value: <specialist value or none>; owner: <verification owner>\`
Prefer ENGAGE for multi-lane/review-heavy work; ADAPTIVE for moderate single-domain; DEFER needs \`Swarm DEFER waiver:\` for deterministic single-owner tasks.
ExitPlanMode only after a complete Seed Spec.`,

  exit: `## Exit Phase
Plan complete — call ExitPlanMode for approval. Ensure complete Seed Spec, Swarm decision audit line, and any DEFER waiver.
No-AI-Slop skill routing: light pass on user-visible plan text; SearchSkill with response language only if prose still looks generic.
If ExitPlanMode reports missing sections, Read/fix only that plan file and retry. Other reads for quick verification allowed.`,
};

const INTERVIEW_SPARSE_ESSENTIALS = [
  'Socratic interview — keep every round valuable:',
  '- Ontological / assumption-led; Baseline + Upgrades (payoff/trade-off) + Defer.',
  '- PATH 1/3 RecordInterviewFinding; PATH 2 AskUserQuestion; research-first when options need evidence.',
  '- Close the open gap below through the current perspective lens.',
  '- When UltraGoal is verifiable (ambiguity ≤ 0.2), NextPhase({ phase: \'write\' }).',
].join('\n');

export function phaseReminder(planFilePath: PlanFilePath, phase: string, agent?: Agent): Promise<string> {
  return buildPhaseReminder(planFilePath, phase, agent);
}

async function buildPhaseReminder(
  planFilePath: PlanFilePath,
  phase: string,
  agent?: Agent,
): Promise<string> {
  const base = `Ultra Plan mode is active. Phase: ${phase.toUpperCase()}.

${PHASE_INSTRUCTIONS[phase] ?? PHASE_INSTRUCTIONS['interview']}`;
  let body = base;

  const interviewState = agent?.planMode.ultraEngine.interviewState;
  const score = interviewState?.ambiguityScore;
  body = body.replaceAll('{{round}}', String(interviewState?.rounds.length ?? 0));
  body = body.replaceAll(
    '{{ambiguityScore}}',
    score === undefined || score === null ? 'scoring pending' : score.overallScore.toFixed(2),
  );
  body = body.replaceAll('{{milestone}}', score?.milestone ?? 'initial');
  body = body.replaceAll('{{nextMilestone}}', nextMilestone(score?.milestone));
  const perspective = agent?.planMode.ultraEngine.currentPerspective ?? 'researcher';
  body = body.replaceAll('{{perspective}}', perspective);
  body = body.replaceAll(
    '{{perspectiveDescription}}',
    agent?.planMode.ultraEngine.getPerspectiveDescription() ?? '',
  );

  const ultraworkGate = ultraworkResumeGate(agent, phase, interviewState?.rounds.length ?? 0);
  if (ultraworkGate !== undefined) {
    body = `${ultraworkGate}\n\n${body}`;
  }

  if (phase === 'interview' && agent !== undefined) {
    const engine = agent.planMode.ultraEngine;
    const readiness = await engine.interviewReadiness({ rescore: false });
    body = `${body}\n\n${formatInterviewReadinessGuide(readiness, {
      perspective: engine.currentPerspective,
      interviewRoundCount: engine.interviewState.rounds.length,
      consecutiveNonUserAnswers: engine.interviewState.consecutiveNonUserAnswers,
    })}`;
  }

  return withPlanFileFooter(body, planFilePath);
}

function ultraworkResumeGate(
  agent: Agent | undefined,
  phase: string,
  interviewRounds: number,
): string | undefined {
  if (agent === undefined) return undefined;
  const run = agent.ultrawork.getRun();
  if (run === null || run.status === 'done' || run.status === 'failed') return undefined;
  const lines = [
    'Ultrawork resume gate:',
    `- Active run ${run.id} is at stage ${run.stage}; continue this run instead of starting a new one.`,
    '- Do not call EnterPlanMode, create a new plan file, or restart UltraPlan from scratch.',
  ];
  if (phase === 'interview' && interviewRounds > 0) {
    lines.push(`- Continue the interview from round ${String(interviewRounds + 1)}.`);
  } else if (phase === 'design' || phase === 'review' || phase === 'write' || phase === 'exit') {
    lines.push(
      `- Resume UltraPlan ${phase} from the checkpoint; do not drop back to interview or redesign from scratch.`,
    );
  }
  return lines.join('\n');
}

function nextMilestone(milestone: string | undefined): string {
  if (milestone === 'initial') return 'progress';
  if (milestone === 'progress') return 'refined';
  if (milestone === 'refined') return 'ready';
  return 'keep asking questions';
}

export function phaseSparseReminder(
  planFilePath: PlanFilePath,
  phase: string,
  agent: Agent,
): Promise<string> {
  return buildPhaseSparseReminder(planFilePath, phase, agent);
}

async function buildPhaseSparseReminder(
  planFilePath: PlanFilePath,
  phase: string,
  agent: Agent,
): Promise<string> {
  const engine = agent.planMode.ultraEngine;
  const score = engine.interviewState.ambiguityScore;
  const scoreText = score ? `score=${score.overallScore.toFixed(2)}` : 'scoring pending';
  let body = `Ultra Plan mode — ${phase.toUpperCase()} phase (${scoreText}). ${PHASE_INSTRUCTIONS[phase]?.split('\n')[0] ?? ''}`;

  if (phase === 'interview') {
    const perspective = engine.currentPerspective;
    body = `${body}\n\n${INTERVIEW_SPARSE_ESSENTIALS}\nPerspective: ${perspective} — ${engine.getPerspectiveDescription()}`;
    const readiness = await engine.interviewReadiness({ rescore: false });
    body = `${body}\n\n${formatInterviewReadinessGuide(readiness, {
      perspective,
      interviewRoundCount: engine.interviewState.rounds.length,
      consecutiveNonUserAnswers: engine.interviewState.consecutiveNonUserAnswers,
      compact: true,
    })}`;
  }

  return withPlanFileFooter(body, planFilePath);
}
