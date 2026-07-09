import type { PlanFilePath } from '../plan';
import type { Agent } from '..';
import { buildResponseLanguageDirective } from './response-language';
import { DynamicInjector } from './injector';
import { LIBRARY_DOCS_RESEARCH_GUIDANCE } from '../../research/library-docs';
import {
  NO_AI_SLOP_SKILL_MANDATE_COMPACT,
  NO_AI_SLOP_SKILL_ROUTING,
} from '../../anti-slop/contract';
import { formatInterviewReadinessGuide } from '../plan/ultra-plan-mode';

const PLAN_MODE_DEDUP_MIN_TURNS = 2;
const PLAN_MODE_FULL_REFRESH_TURNS = 5;

/**
 * Plan-mode reminder variants.
 *
 * `reentry` is used once when a restored planning session already has plan
 * content. `full` is used for the first reminder and periodic refreshes.
 * `sparse` keeps the read-only invariant visible between full reminders.
 * `ultra` is used when ultra plan mode is active.
 */
export type PlanModeVariant = 'full' | 'sparse' | 'reentry' | 'ultra';

export class PlanModeInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'plan_mode';
  private wasActive = false;

  override onContextClear(): void {
    super.onContextClear();
    this.wasActive = this.agent.planMode.isActive;
  }

  override async getInjection(): Promise<string | undefined> {
    const { isActive, planFilePath, isUltraMode, phase } = this.agent.planMode;
    if (!isActive) {
      if (!this.wasActive) {
        return undefined;
      }
      this.wasActive = false;
      this.injectedAt = null;
      return exitReminder();
    }
    if (!this.wasActive) {
      this.injectedAt = null;
      this.wasActive = true;
      if (isUltraMode) {
        return withResponseLanguage(await phaseReminder(planFilePath, phase, this.agent), this.agent);
      }
      if (await this.hasCurrentPlanContent()) {
        return withResponseLanguage(reentryReminder(planFilePath), this.agent);
      }
    }
    const variant = this.getVariant();
    if (variant === null) return undefined;

    if (isUltraMode) {
      return variant === 'full' || variant === 'reentry'
        ? withResponseLanguage(await phaseReminder(planFilePath, phase, this.agent), this.agent)
        : withResponseLanguage(await phaseSparseReminder(planFilePath, phase, this.agent), this.agent);
    }

    return variant === 'full'
      ? withResponseLanguage(fullReminder(planFilePath), this.agent)
      : variant === 'sparse'
        ? withResponseLanguage(sparseReminder(planFilePath), this.agent)
        : withResponseLanguage(reentryReminder(planFilePath), this.agent);
  }

  protected getVariant(): PlanModeVariant | null {
    if (this.injectedAt === null) return 'full';
    const history = this.agent.context.history;
    let assistantTurnsSince = 0;
    for (let i = this.injectedAt + 1; i < history.length; i++) {
      const msg = history[i];
      if (msg === undefined) continue;
      if (msg.role === 'assistant') {
        assistantTurnsSince += 1;
        continue;
      }
      if (msg.role === 'user') {
        return 'full';
      }
    }
    if (assistantTurnsSince >= PLAN_MODE_FULL_REFRESH_TURNS) return 'full';
    if (assistantTurnsSince >= PLAN_MODE_DEDUP_MIN_TURNS) return 'sparse';
    return null;
  }

  private async hasCurrentPlanContent(): Promise<boolean> {
    try {
      const data = await this.agent.planMode.data();
      return data !== null && data.content.trim().length > 0;
    } catch {
      return false;
    }
  }
}
function withPlanFileFooter(body: string, planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) return body;
  return `${body}\n\nPlan file: ${planFilePath}`;
}

function withResponseLanguage(body: string, agent: Agent): string {
  const preference = agent.getResponseLanguagePreference?.();
  if (preference === undefined) return body;
  return `${body}\n\n${buildResponseLanguageDirective(preference, { wrapped: false })}`;
}

const PLAN_MODE_BLOCKED_TOOLS =
  'TaskStop, CronCreate, and CronDelete are blocked in plan mode — call ExitPlanMode first if you need them.';

const PLAN_READ_ONLY_WITH_FILE = `Plan mode is active. You MUST NOT make any edits (except the current plan file) or change the system unless a tool request is explicitly approved. Prefer read-only tools. Bash only when needed; Bash follows normal permission rules. This supersedes other instructions. ${PLAN_MODE_BLOCKED_TOOLS}`;

const PLAN_READ_ONLY_NO_FILE = `Plan mode is active. You MUST NOT make any edits or change the system unless a tool request is explicitly approved. Prefer read-only tools. Bash only when needed; Bash follows normal permission rules. This supersedes other instructions.`;

const PLAN_WORKFLOW = `Workflow:
  1. Understand — Glob, Grep, Read; Context7Resolve/Context7Docs for library docs; WebSearch/FetchURL when external evidence affects the plan.
  2. Design — one best approach; trade-offs only when they matter.
  3. Review — re-read key files.
  4. Write Plan — Write or Edit the plan file (Write if missing). ${NO_AI_SLOP_SKILL_MANDATE_COMPACT}
  5. Exit — ExitPlanMode for approval.

TodoList is the live execution board during planning — durable plan content goes in the plan file only.`;

const PLAN_MULTI_APPROACH = `## Multiple approaches
At most 2–3 meaningfully different options; do not pad minor variants. If user preference matters, AskUserQuestion first.
Multiple approaches in the plan → pass \`options\` to ExitPlanMode so the user can choose.
NEVER write multiple approaches and call ExitPlanMode without \`options\`.

AskUserQuestion: missing requirements or preferences only — never plan approval (user cannot see the plan until ExitPlanMode).
End every turn with AskUserQuestion (clarify) or ExitPlanMode (approve).`;

function fullReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineFullReminder();
  }

  const body = `${PLAN_READ_ONLY_WITH_FILE}

${PLAN_WORKFLOW}

${PLAN_MULTI_APPROACH}`;
  return withPlanFileFooter(body, planFilePath);
}

function sparseReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineSparseReminder();
  }

  const body = `Plan mode still active (see full instructions earlier). Read-only except the plan file — Write/Edit it (Write if missing). Bash when needed. AskUserQuestion for user preferences; pass \`options\` to ExitPlanMode when multiple approaches exist. End with AskUserQuestion or ExitPlanMode — never ask plan approval via text.`;
  return withPlanFileFooter(body, planFilePath);
}

function reentryReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineReentryReminder();
  }

  const body = `${PLAN_READ_ONLY_WITH_FILE}

## Re-entering Plan Mode
A plan file from a prior session exists. Before proceeding:
  1. Read the existing plan file.
  2. Compare to the current request — new task: replace; same task: update.
  3. Write/Edit the plan file (Write if missing).
  4. AskUserQuestion for missing requirements/preferences.
  5. Edit the plan file before ExitPlanMode.

End with AskUserQuestion or ExitPlanMode.`;
  return withPlanFileFooter(body, planFilePath);
}

function inlineFullReminder(): string {
  return `${PLAN_READ_ONLY_NO_FILE}

${PLAN_WORKFLOW.replace('Write or Edit the plan file (Write if missing).', 'Wait for the host to provide a plan file path, write there, then ExitPlanMode.')}

${PLAN_MULTI_APPROACH}`;
}

function inlineSparseReminder(): string {
  return `Plan mode still active (see full instructions earlier). Read-only; no plan file path in this host — wait for the host to provide a plan file path before ExitPlanMode. AskUserQuestion for preferences; pass \`options\` when multiple approaches exist. End with AskUserQuestion or ExitPlanMode.`;
}

function inlineReentryReminder(): string {
  return `${PLAN_READ_ONLY_NO_FILE}

## Re-entering Plan Mode
No plan file path in this host. Re-evaluate the request, AskUserQuestion for gaps, wait for the host path, write the plan, ExitPlanMode. End with AskUserQuestion or ExitPlanMode.`;
}

function exitReminder(): string {
  return `Plan mode is no longer active. The read-only and plan-file-only restrictions from plan mode no longer apply. Continue with the approved plan using the normal tool and permission rules.`;
}

// ── Ultra Plan Mode phase-aware reminders ──────────────────────────────────

const PHASE_INSTRUCTIONS: Record<string, string> = {
  research: `## Research Phase
Allowed: Context7Resolve, Context7Docs, WebSearch, FetchURL, LioraContext, LioraRead, LioraSearch, LioraTree, LioraSymbol, LioraCallgraph, LioraExpand, Read, Grep, Glob, ReadMediaFile, SearchSkill, Skill, SearchExpert, read-only Bash, TodoList progress tracking, NextPhase.
AskUserQuestion, Write, Edit, TaskStop, CronCreate, CronDelete, ExitPlanMode are BLOCKED.

Goal: gather current, source-backed context and improvement levers before the UltraPlan interview elevates the user's goal and presents upgrade choices.
Collect: facts, best practices, benchmarks, comparable patterns, and quality dimensions (UX, performance, maintainability, conversion, reliability) that can become interview options.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}
Prefer LioraContext (compose), LioraSearch, LioraSymbol, Grep, Glob, LioraRead before broad Read. SearchExpert for specialist lanes. Fetch primary sources; distill an evidence pack. Do not ask the user.

Your turn MUST end with a short evidence-pack summary, then call NextPhase({ phase: 'interview' }).`,

  interview: `## Interview Phase
Mission: interview quality drives plan quality. Do not merely execute the user's prompt — act as an expert leader who teaches, surfaces unknown-unknowns, and elevates the goal with evidence-backed upgrade paths.

Allowed: Context7Resolve, Context7Docs, WebSearch, FetchURL, LioraContext, LioraRead, LioraSearch, LioraTree, LioraSymbol, LioraCallgraph, LioraExpand, Read, Grep, Glob, ReadMediaFile, SearchSkill, Skill, SearchExpert, read-only Bash, TodoList progress tracking, AskUserQuestion, RecordInterviewFinding, NextPhase.
Write, Edit, TaskStop, CronCreate, CronDelete, ExitPlanMode BLOCKED.

Expert leader mindset:
- Surface unknown-unknowns: risks, opportunities, and industry patterns the user did not mention.
- Teach briefly: one concrete insight per round (1-2 sentences; cite sources when possible).
- Propose upgrade paths: options with clear payoffs (visual polish, UX, performance, maintainability, conversion, reliability, speed to ship).
- Preserve user agency: always include a Baseline (original scope) and a Defer/minimal path — never force an upgrade.

Question routing — minimize user fatigue, maximize decision quality:
- PATH 1 (auto-answer): If the codebase, config, or manifest already answers the question, use RecordInterviewFinding with origin "code". Do NOT ask the user.
- PATH 2 (user judgment): Goal, acceptance criteria, trade-offs, business logic, visual/scope preferences → ALWAYS use AskUserQuestion. These are human decisions.
- PATH 3 (research): External facts (API versions, pricing, compatibility) → research first, then use RecordInterviewFinding with origin "research". Confirm surprising findings with the user.
- When in doubt → PATH 2. Asking is safer than guessing.
- The Dialectic Rhythm Guard limits consecutive non-user findings. After 3 in a row, you MUST use AskUserQuestion next.

Before each AskUserQuestion when needed, research-first is strongly encouraged: search and read current sources so insights, defaults, and discrete options are evidence-backed.
${LIBRARY_DOCS_RESEARCH_GUIDANCE}
Prefer Context7Resolve/Context7Docs for library APIs; WebSearch/FetchURL for external facts; LioraContext, LioraRead, Grep, Glob for codebase facts. Skip extra research when the evidence pack already answers the gap.

Refine gate — preserve user intent:
When the user gives a free-text answer (via "Other" or an open question), do not compress it to one line. Structure it before the next round:
- Decision: [the core choice]
- Reasoning: [why, 1-2 bullets]
- Constraints: [user-stated limits]
- Out of scope: [what the user deferred]
- Codebase context: [what you verified from code]
This structure feeds the Seed Spec extraction — sloppy compression loses intent.

Restate gate — before advancing:
Before calling NextPhase to Design, restate the agreed goal in one sentence and confirm with the user via AskUserQuestion:
"Based on our discussion, the goal is: <one sentence>. If someone read only this line, would they arrive at the same outcome you have in mind?"
Options: [Yes, advance to Design] / [Adjust wording] / [Missing scope].
This is the ONLY point where one-line compression is allowed.

Perspective: {{perspective}} — {{perspectiveDescription}}

Rotate 5 lenses each round for a distinct improvement angle: Researcher, Simplifier, Architect, Breadth-keeper, Seed-closer.

UltraGoal must be judgeable as complete/incomplete, true/false, or pass/fail.
NextPhase to Design is blocked until ambiguity <= 0.2, all per-dimension clarity floors pass, no required gaps remain, and the UltraGoal is verifiable.
The live readiness checklist below lists exact blockers and the one question to ask next — follow it; do not guess or repeat resolved topics.
Seed Spec is auto-extracted from interview answers on Design transition. Do not Write or Edit the plan file during Interview.

Round {{round}} | perspective {{perspective}} | ambiguity {{ambiguityScore}} | milestone {{milestone}} | next {{nextMilestone}}

AskUserQuestion design:
- Before calling NextPhase, read the readiness checklist — if NOT READY, ask only about the listed NEXT TURN focus.
- Ask 1-2 focused questions per call when a missing decision blocks a verifiable UltraGoal or required Seed section, or when an upgrade choice materially changes the plan.
- Each round must close at least one open gap or add a Completion Criterion — never repeat a question about a section already captured.
- Option shape: Baseline (user's original intent) + 1-3 Upgrades (named payoff + trade-off in description) + Defer/minimal scope when relevant.
- Append "(Recommended)" only when evidence strongly favors one upgrade; never recommend without a reason.
- Lead with a short insight when it helps the user learn ("adding X typically improves Y because …").

Do not advance just because the task feels actionable. If AskUserQuestion is unavailable, surface the gap — do not fake completion.
Do not call EnterPlanMode while already in Ultra Plan; use NextPhase to advance phases, never EnterPlanMode(phase).

Your turn MUST end with AskUserQuestion, RecordInterviewFinding, or NextPhase. Read-only research in the same turn is allowed and encouraged when it improves the next question.`,

  design: `## Design Phase
Read-only tools plus TodoList progress tracking (Read, Grep, Glob, WebSearch, FetchURL, SearchSkill, Skill, SearchExpert, TodoList, read-only Bash). Write/Edit BLOCKED.

Explore and converge on one approach. Use TodoList to keep the live design work board current. SearchSkill/Skill for task-specific guidance when it improves the design. SearchExpert for UltraSwarm candidates. Bash: read-only inspection only.

Cannot write the plan file or call ExitPlanMode.
Your turn MUST end with a design summary, then call NextPhase({ phase: 'review' }). Do not skip directly to write.`,

  review: `## Review Phase
Read-only tools plus TodoList progress tracking (Read, ReadMediaFile, Grep, Glob, LioraContext, LioraRead, LioraSearch, LioraTree, LioraSymbol, LioraCallgraph, LioraExpand, WebSearch, FetchURL, SearchSkill, Skill, SearchExpert, TodoList, TaskList, TaskOutput, read-only Bash inspection). Write, Edit, general Bash BLOCKED.

Verify design against code. Search and fetch current sources again when external claims stay uncertain. Use TodoList to keep verification gaps and completed checks current.
Bash read-only: pwd, ls, cat, sed -n, head/tail, wc, file/stat, find without actions, grep/rg, jq, read-only git.

Cannot write the plan file or call ExitPlanMode.
Your turn MUST end with a verification summary, then call NextPhase({ phase: 'write' }).`,

  write: `## Write Phase
You may ONLY write to the current plan file. All other file edits are BLOCKED. You may read only the current plan file, update TodoList for progress tracking, use SearchSkill/Skill for the no-AI-slop prose gate, and use NextPhase or ExitPlanMode when complete.

Before writing plan prose that users will read, apply the no-AI-slop prose gate (light pass first; SearchSkill → Skill only if needed):
${NO_AI_SLOP_SKILL_ROUTING}

Write sections: Seed Spec, AC Tree, Swarm Decision, WorkGraph, Evaluation Plan, Execution Plan.
Include: \`Swarm decision: ENGAGE|DEFER - <reason>; value: <specialist value or none>; owner: <verification owner>\`
Prefer ENGAGE for multi-lane or review-heavy work. DEFER needs \`Swarm DEFER waiver:\` for deterministic single-owner tasks.
ExitPlanMode only after a complete Seed Spec. Write/Edit the plan file (Write if missing).`,

  exit: `## Exit Phase
Plan complete — call ExitPlanMode for approval. Ensure complete Seed Spec, Swarm decision audit line, and any DEFER waiver. Quick anti-slop light pass on user-visible plan text before ExitPlanMode; SearchSkill → Skill only if prose still reads generic.
${NO_AI_SLOP_SKILL_ROUTING}
If ExitPlanMode reports missing sections, Read the current plan file if needed, correct only that plan file, and retry.`,
};

const INTERVIEW_SPARSE_ESSENTIALS = [
  'Expert-leader interview — keep every round valuable:',
  '- Teach one brief insight or unknown-unknown when it helps the user decide.',
  '- AskUserQuestion: Baseline + Upgrades (payoff/trade-off) + Defer; research-first when options need evidence.',
  '- Close the open gap below through the current perspective lens — not a bare checklist question.',
  '- Read-only research in the same turn is fine when it improves the next question.',
].join('\n');

function phaseReminder(planFilePath: PlanFilePath, phase: string, agent?: Agent): Promise<string> {
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
  }
  return lines.join('\n');
}

function nextMilestone(milestone: string | undefined): string {
  if (milestone === 'initial') return 'progress';
  if (milestone === 'progress') return 'refined';
  if (milestone === 'refined') return 'ready';
  return 'keep asking questions';
}

function phaseSparseReminder(
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
    })}`;
  }

  return withPlanFileFooter(body, planFilePath);
}
