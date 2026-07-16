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
  'Context7Resolve, Context7Docs, WebSearch, FetchURL, LioraRead, LioraTree, LioraSymbol, LioraCallgraph, LioraExpand, Read, Grep, Glob, ReadMediaFile, SearchSkill, Skill, SearchExpert, read-only Bash, TodoList progress tracking';

const ULTRA_PLAN_BLOCKED_MUTATORS = 'Write, Edit, TaskStop, CronCreate, CronDelete, ExitPlanMode BLOCKED.';
const ULTRA_PLAN_INTERVIEW_BLOCKED_MUTATORS =
  'TaskStop, CronCreate, CronDelete, ExitPlanMode BLOCKED. Product Write/Edit allowed for investigation prototypes under planMode; plan-file Write/Edit still deferred to Write phase (Seed Spec auto-extracts on Design).';

const PHASE_INSTRUCTIONS: Record<string, string> = {
  research: `## Research Phase
Allowed: ${ULTRA_PLAN_READ_TOOLS}, NextPhase.
AskUserQuestion, ${ULTRA_PLAN_BLOCKED_MUTATORS}

Goal: source-backed context + improvement levers before UltraPlan interview elevates goals.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}
Evidence-first: prefer Grep, LioraSymbol, Glob, LioraRead before broad Read; cite concrete paths. Research is product-write read-only — no plan file Write/Edit.
Distill an evidence pack; do not ask the user.
Your turn MUST end with a short evidence-pack summary, then call NextPhase({ phase: 'interview' }).`,

  interview: `## Interview Phase
Mission: interview quality drives plan quality. Do not merely execute the prompt — act as an expert leader who teaches, surfaces unknown-unknowns, and elevates the goal with evidence-backed upgrades.

Allowed: ${ULTRA_PLAN_READ_TOOLS}, AskUserQuestion, RecordInterviewFinding, NextPhase, product Write/Edit for investigation prototypes.
${ULTRA_PLAN_INTERVIEW_BLOCKED_MUTATORS}

Routing:
- PATH 1 auto-answer from code/config via RecordInterviewFinding(origin="code").
- PATH 2 user judgment (goal, acceptance, trade-offs, visual/scope) via AskUserQuestion.
- PATH 3 external facts: research first, RecordInterviewFinding(origin="research"); confirm surprises with the user.
- When in doubt → PATH 2. After 3 consecutive non-user findings, must AskUserQuestion. Research-first before AskUserQuestion when options need evidence. Prefer Context7Resolve/Context7Docs for library APIs; WebSearch/FetchURL for external facts; LioraRead, Grep, Glob for codebase facts.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}

UltraGoal must be judgeable as complete/incomplete, true/false, or pass/fail.
Hard gate for NextPhase to Design: verifiable UltraGoal only. Soft seed gaps, ambiguity floors, and open_gaps are recommendations — they do not hard-block Design.
Follow the live readiness checklist below; do not guess or repeat resolved topics.
Prefer not to Write the formal plan file during Interview (Seed Spec auto-extracts on Design). Product-file Write/Edit for investigation prototypes is allowed under planMode.

Round {{round}} | Perspective: {{perspective}} — {{perspectiveDescription}} | ambiguity {{ambiguityScore}} | milestone {{milestone}} | next {{nextMilestone}}

AskUserQuestion: 1-2 focused assumption-led questions — Baseline + 1-3 Upgrades (payoff/trade-off) + Defer/minimal. Prioritize decisions that lock a verifiable UltraGoal. Lead with a short insight when helpful. Do not advance just because the task feels actionable. Do not call EnterPlanMode while already in Ultra Plan; use NextPhase.

Your turn MUST end with AskUserQuestion, RecordInterviewFinding, or NextPhase. Same-turn investigation (including product Write/Edit prototypes) is allowed.`,

  design: `## Design Phase
Allowed: ${ULTRA_PLAN_READ_TOOLS}. Write/Edit BLOCKED.
Converge on one approach. TodoList for the live design board; SearchSkill/Skill when useful; SearchExpert for UltraSwarm candidates.
Cannot write the plan file or call ExitPlanMode. Your turn MUST end with a design summary, then NextPhase({ phase: 'review' }). Do not skip to write.`,

  review: `## Review Phase
Allowed: ${ULTRA_PLAN_READ_TOOLS}, TaskList, TaskOutput. Write, Edit, general Bash BLOCKED.
Verify design against code. Re-search when external claims stay uncertain. TodoList for verification gaps.
Bash read-only: cat, sed -n, head/tail, grep/rg, read-only git (+ ls/find/jq as needed).
Cannot write the plan file or call ExitPlanMode.
Your turn MUST end with a verification summary, then NextPhase({ phase: 'write' }).`,

  write: `## Write Phase
You may ONLY write to the current plan file. All other file edits BLOCKED. Reading (Read, Grep, Glob, WebSearch, FetchURL, Liora*) for quick verification — stay on the plan file. TodoList for progress; SearchSkill/Skill for no-AI-slop; NextPhase or ExitPlanMode when complete.

Before writing user-visible plan prose: ${NO_AI_SLOP_SKILL_MANDATE_COMPACT}
No-AI-Slop: SearchSkill with response language + surface keywords → Skill only if light pass fails.

Write sections: Seed Spec, AC Tree, Swarm Decision, WorkGraph, Evaluation Plan, Execution Plan.
Include: \`Swarm decision: ENGAGE|ADAPTIVE|DEFER - <reason>; Swarm intensity: light|standard|heavy; value: <specialist value or none>; owner: <verification owner>\`
Prefer ENGAGE for multi-lane/review-heavy work; ADAPTIVE for moderate single-domain; DEFER needs \`Swarm DEFER waiver:\` for deterministic single-owner tasks.
ExitPlanMode only after a complete Seed Spec.`,

  exit: `## Exit Phase
Plan complete — call ExitPlanMode for approval. Ensure complete Seed Spec, Swarm decision audit line, and any DEFER waiver.
No-AI-Slop skill routing: light pass on user-visible plan text; SearchSkill with response language only if prose still reads generic.
If ExitPlanMode reports missing sections, Read/fix only that plan file and retry. Other reads for quick verification allowed.`,
};

const INTERVIEW_SPARSE_ESSENTIALS = [
  'Expert-leader interview — keep every round valuable:',
  '- Teach one brief insight/unknown-unknown when it helps decide.',
  '- AskUserQuestion: Baseline + Upgrades (payoff/trade-off) + Defer; research-first when options need evidence.',
  '- Close the open gap below through the current perspective lens — not a bare checklist question.',
  '- Same-turn read-only research is fine when it improves the next question.',
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
