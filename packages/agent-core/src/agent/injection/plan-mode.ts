import type { PlanFilePath } from '../plan';
import type { Agent } from '..';
import { DynamicInjector } from './injector';

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
        return phaseReminder(planFilePath, phase);
      }
      if (await this.hasCurrentPlanContent()) {
        return reentryReminder(planFilePath);
      }
    }
    const variant = this.getVariant();
    if (variant === null) return undefined;

    if (isUltraMode) {
      return variant === 'full' || variant === 'reentry'
        ? phaseReminder(planFilePath, phase, this.agent)
        : phaseSparseReminder(planFilePath, phase, this.agent);
    }

    return variant === 'full'
      ? fullReminder(planFilePath)
      : variant === 'sparse'
        ? sparseReminder(planFilePath)
        : reentryReminder(planFilePath);
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

function fullReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineFullReminder();
  }

  const body = `Plan mode is active. You MUST NOT make any edits (with the exception of the current plan file) or otherwise make changes to the system unless a tool request is explicitly approved. Prefer read-only tools. Use Bash only when needed; Bash follows the normal permission mode and rules. This supersedes any other instructions you have received. TaskStop, CronCreate, and CronDelete are also blocked in plan mode — call ExitPlanMode first if you need them.

Workflow:
  1. Understand — explore the codebase with Glob, Grep, Read, and use WebSearch/FetchURL when current external evidence can affect the plan.
  2. Design — converge on the best approach; consider trade-offs but aim for a single recommendation.
  3. Review — re-read key files to verify understanding.
  4. Write Plan — modify the plan file with Write or Edit. Use Write if the plan file does not exist yet.
  5. Exit — call ExitPlanMode for user approval.

## Handling multiple approaches
Keep it focused: at most 2-3 meaningfully different approaches. Do NOT pad with minor variations — if one approach is clearly superior, just propose that one.
When the best approach depends on user preferences, constraints, or context you don't have, use AskUserQuestion to clarify first. This helps you write a better, more targeted plan rather than dumping multiple options for the user to sort through.
When you do include multiple approaches in the plan, you MUST pass them as the \`options\` parameter when calling ExitPlanMode, so the user can select which approach to execute at approval time.
NEVER write multiple approaches in the plan and call ExitPlanMode without the \`options\` parameter — the user will only see the default approval controls with no way to choose a specific approach.

AskUserQuestion is for clarifying missing requirements or user preferences that affect the plan.
Never ask about plan approval via text or AskUserQuestion.
Your turn must end with either AskUserQuestion (to clarify requirements or preferences) or ExitPlanMode (to request plan approval). Do NOT end your turn any other way.
Do NOT use AskUserQuestion to ask about plan approval or reference "the plan" — the user cannot see the plan until you call ExitPlanMode.`;
  return withPlanFileFooter(body, planFilePath);
}

function sparseReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineSparseReminder();
  }

  const body = `Plan mode still active (see full instructions earlier). Prefer read-only tools except the current plan file. Use Write or Edit to modify the plan file. If it does not exist yet, create it with Write first. Use Bash only when needed; Bash follows the normal permission mode and rules. Use AskUserQuestion to clarify user preferences when it helps you write a better plan. If the plan has multiple approaches, pass options to ExitPlanMode so the user can choose. End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for approval). Never ask about plan approval via text or AskUserQuestion.`;
  return withPlanFileFooter(body, planFilePath);
}

function reentryReminder(planFilePath: PlanFilePath): string {
  if (planFilePath === null || planFilePath.length === 0) {
    return inlineReentryReminder();
  }

  const body = `Plan mode is active. You MUST NOT make any edits (with the exception of the current plan file) or otherwise make changes to the system unless a tool request is explicitly approved. Prefer read-only tools. Use Bash only when needed; Bash follows the normal permission mode and rules. This supersedes any other instructions you have received.

## Re-entering Plan Mode
A plan file from a previous planning session already exists.
Before proceeding:
  1. Read the existing plan file to understand what was previously planned.
  2. Evaluate the user's current request against that plan.
  3. If different task: replace the old plan with a fresh one. If same task: update the existing plan.
  4. You may use Write or Edit to modify the plan file. If the file does not exist yet, create it with Write first.
  5. Use AskUserQuestion to clarify missing requirements or user preferences that affect the plan.
  6. Always edit the plan file before calling ExitPlanMode.

Your turn must end with either AskUserQuestion (to clarify requirements) or ExitPlanMode (to request plan approval).`;
  return withPlanFileFooter(body, planFilePath);
}

function inlineFullReminder(): string {
  return `Plan mode is active. You MUST NOT make any edits or otherwise make changes to the system unless a tool request is explicitly approved. Prefer read-only tools. Use Bash only when needed; Bash follows the normal permission mode and rules. This supersedes any other instructions you have received.

Workflow:
  1. Understand — explore the codebase with Glob, Grep, Read, and use WebSearch/FetchURL when current external evidence can affect the plan.
  2. Design — converge on the best approach; consider trade-offs but aim for a single recommendation.
  3. Review — re-read key files to verify understanding.
  4. Wait for the host to provide a plan file path, write the plan there, then call ExitPlanMode.

## Handling multiple approaches
Keep it focused: at most 2-3 meaningfully different approaches. Do NOT pad with minor variations — if one approach is clearly superior, just propose that one.
When the best approach depends on user preferences, constraints, or context you don't have, use AskUserQuestion to clarify first.
When you do include multiple approaches in the plan, you MUST pass them as the \`options\` parameter when calling ExitPlanMode, so the user can select which approach to execute at approval time.

AskUserQuestion is for clarifying missing requirements or user preferences that affect the plan.
Never ask about plan approval via text or AskUserQuestion.
Your turn must end with either AskUserQuestion (to clarify requirements or preferences) or ExitPlanMode (to request plan approval). Do NOT end your turn any other way.`;
}

function inlineSparseReminder(): string {
  return `Plan mode still active (see full instructions earlier). Read-only; no plan file path is available in this host. Wait for the host to provide a plan file path before calling ExitPlanMode. Use AskUserQuestion to clarify user preferences when it helps you write a better plan. If the plan has multiple approaches, pass options to ExitPlanMode so the user can choose. End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for approval).`;
}

function inlineReentryReminder(): string {
  return `Plan mode is active. You MUST NOT make any edits or otherwise make changes to the system unless a tool request is explicitly approved. Prefer read-only tools. Use Bash only when needed; Bash follows the normal permission mode and rules. This supersedes any other instructions you have received.

## Re-entering Plan Mode
No plan file path is available in this host.
Before proceeding:
  1. Re-evaluate the user request and any existing conversation context.
  2. Use AskUserQuestion to clarify missing requirements or user preferences that affect the plan.
  3. Wait for the host to provide a plan file path, write the revised plan there, then call ExitPlanMode.

Your turn must end with either AskUserQuestion (to clarify requirements) or ExitPlanMode (to request plan approval).`;
}

function exitReminder(): string {
  return `Plan mode is no longer active. The read-only and plan-file-only restrictions from plan mode no longer apply. Continue with the approved plan using the normal tool and permission rules.`;
}

// ── Ultra Plan Mode phase-aware reminders ──────────────────────────────────

const PHASE_INSTRUCTIONS: Record<string, string> = {
  research: `## Research Phase
You are in the Research Phase. Your allowed tools are read-only evidence tools: WebSearch, FetchURL, KimiContext, Read, Grep, Glob, ReadMediaFile, SearchSkill, Skill, SearchExpert, narrow read-only Bash inspection, TodoList for progress tracking, and NextPhase.
AskUserQuestion, Write, Edit, TaskStop, CronCreate, CronDelete, and ExitPlanMode are BLOCKED.

Goal: gather current, source-backed context before the UltraPlan interview creates question options or asks the user to choose.
- Search current docs, release notes, papers, security advisories, benchmark pages, or OSS examples when they can affect correctness.
- Use KimiContext, Grep, Glob, and Read for local code facts before asking path or architecture questions.
- Use SearchExpert when Ultrawork may need specialist lanes; capture candidate expert IDs before writing the Swarm decision.
- Fetch primary sources before relying on snippets. Label findings as verified, candidate, stale/offline, or irrelevant.
- Distill a compact evidence pack: facts learned, source URLs or file paths, remaining unknowns, and which unknowns truly require user input.
- Do not ask the user anything in this phase; the point is to avoid pretrained-only options.

Your turn MUST end with a short evidence-pack summary, then call NextPhase({ phase: 'interview' }).`,

  interview: `## Interview Phase
You are in the Interview Phase. Your ONLY allowed tools are AskUserQuestion and NextPhase.
Write, Edit, Bash, TaskStop, CronCreate, CronDelete, and ExitPlanMode are BLOCKED.

## Current Perspective: {{perspective}}
{{perspectiveDescription}}

## Multi-Perspective Interview (Ouroboros-style)
Each round rotates through 5 perspectives:
1. Researcher — Explore background and context
2. Simplifier — Challenge assumptions, reduce complexity
3. Architect — Structure, components, interfaces
4. Breadth-keeper — Edge cases, non-goals, scope
5. Seed-closer — Precision, measurable criteria

  ## Ambiguity + Seed Gap Gate (real-time)
  The system evaluates clarity and required Seed sections:
  - UltraGoal must be judgeable as complete/incomplete, true/false, or pass/fail.
  - Required sections: goal, actors, inputs, outputs, constraints, non-goals, acceptance criteria, verification plan, failure modes, runtime context.
  - Required gaps close only from the user's initial context and answers, not from labels you put in your question text.
  - NextPhase to Design is blocked until ambiguity <= 0.2, all per-dimension clarity floors pass, no required gaps remain, and the UltraGoal is verifiable.

Current interview round: {{round}}
Current perspective: {{perspective}}
Current ambiguity score: {{ambiguityScore}}
Current milestone: {{milestone}}

Next milestone target: {{nextMilestone}}

Ask 1-3 focused questions per AskUserQuestion call when a missing decision blocks a true/false-verifiable UltraGoal or a required Seed section.
Do not advance just because the task feels actionable. If AskUserQuestion is unavailable or rejected by policy, surface the unresolved gap instead of pretending the interview is complete.
Do not call EnterPlanMode while already in Ultra Plan. EnterPlanMode starts planning; NextPhase advances phases. Do not pass a phase argument to EnterPlanMode.
Your turn MUST end with AskUserQuestion or NextPhase.`,

  design: `## Design Phase
You are in the Design Phase. Read-only tools plus TodoList progress tracking only (Read, Grep, Glob, WebSearch, FetchURL, SearchSkill, Skill, SearchExpert, TodoList, and read-only Bash inspection).
Write and Edit are BLOCKED.

Goal: Explore the codebase and converge on the best approach.
- Use Read, Grep, Glob to understand relevant code
- Use TodoList to keep the live design work board current
- Use SearchSkill and Skill when task-specific skill instructions would improve the design
- Use SearchExpert to map coverage lanes to concrete UltraSwarm expert candidates before deciding ENGAGE/DEFER
- Consider trade-offs but aim for a single recommendation
- Identify key files, architectural decisions, and risks
- You may use Bash only for read-only inspection: pwd, ls, cat, sed -n, head/tail, wc, file/stat, find without actions, grep/rg, jq, and read-only git commands

You CANNOT write to the plan file yet. You CANNOT call ExitPlanMode.
Your turn MUST end with a design summary, then call NextPhase({ phase: 'review' }). Do not skip directly to write.`,

  review: `## Review Phase
You are in the Review Phase. Read-only tools plus TodoList progress tracking only (Read, ReadMediaFile, Grep, Glob, KimiContext, WebSearch, FetchURL, SearchSkill, Skill, SearchExpert, TodoList, TaskList, TaskOutput, and read-only Bash inspection).
Write, Edit, and general Bash execution are BLOCKED.

Goal: Re-read key files to verify your understanding before writing the plan.
- Verify your design assumptions against actual code
- Search and fetch current sources again when an external API, library, paper, security issue, or best-practice claim remains uncertain
- SearchExpert again if the capability coverage matrix has material lanes but no concrete expert candidates
- Use TodoList to keep verification gaps and completed checks current
- Check edge cases and failure modes
- Confirm file paths and dependencies
- You may use Bash only for read-only inspection: pwd, ls, cat, sed -n, head/tail, wc, file/stat, find without actions, grep/rg, jq, and read-only git commands

You CANNOT write to the plan file yet. You CANNOT call ExitPlanMode.
Your turn MUST end with a verification summary, then call NextPhase({ phase: 'write' }).`,

  write: `## Write Phase
You are in the Write Phase. You may ONLY write to the current plan file.
All other file edits are BLOCKED. You may read only the current plan file, update TodoList for progress tracking, and use NextPhase or ExitPlanMode when the plan is complete.

Goal: Write the complete plan to the plan file with these sections:
1. Seed Spec — Verifiable UltraGoal, Completion Criterion, Actors, Inputs, Outputs, Constraints, Non-goals, Acceptance Criteria, Verification Plan, Failure Modes, Runtime Context
2. AC Tree — hierarchical acceptance criteria with statuses
3. Swarm Decision — Decision, Reason, Specialist value, Verification owner
4. WorkGraph — node id, AC id, stage, owner/lane, dependencies, and required evidence for each executable unit
5. Evaluation Plan — how the implementation will be verified
6. Execution Plan — step-by-step implementation plan

You MUST fill out the Seed Spec template completely.
You MUST include one auditable line in this exact shape before implementation: Swarm decision: ENGAGE|DEFER - <reason>; value: <specialist value or none>; owner: <verification owner>.
Prefer ENGAGE whenever the AC Tree or coverage matrix has more than one material expertise lane, subjective UX/visual quality, external/domain correctness, security/privacy/compliance, performance/reliability, accessibility/i18n, hard-to-observe runtime behavior, or any independent review need.
DEFER is allowed only for a deterministic single-owner task. If you choose DEFER, include a Swarm DEFER waiver field that explicitly explains why no specialist subagent is needed despite the default-to-ENGAGE rule.
You can call ExitPlanMode ONLY after the plan file contains a complete Seed Spec.

Use Write or Edit to modify the plan file. If it does not exist, create it first.`,

  exit: `## Exit Phase
The plan is complete. Call ExitPlanMode to request user approval.
Make sure the plan file contains a complete Seed Spec, exact Swarm decision audit line, and any required Swarm DEFER waiver before exiting.
If ExitPlanMode reports missing sections, Read the current plan file if needed, correct only that plan file with Write/Edit, and call ExitPlanMode again.`,
};

function phaseReminder(planFilePath: PlanFilePath, phase: string, agent?: Agent): string {
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

  return withPlanFileFooter(body, planFilePath);
}

function nextMilestone(milestone: string | undefined): string {
  if (milestone === 'initial') return 'progress';
  if (milestone === 'progress') return 'refined';
  if (milestone === 'refined') return 'ready';
  return 'keep asking questions';
}

function phaseSparseReminder(planFilePath: PlanFilePath, phase: string, agent: Agent): string {
  const engine = agent.planMode.ultraEngine;
  const score = engine.interviewState.ambiguityScore;
  const scoreText = score ? `score=${score.overallScore.toFixed(2)}` : 'scoring pending';
  const body = `Ultra Plan mode — ${phase.toUpperCase()} phase (${scoreText}). ${PHASE_INSTRUCTIONS[phase]?.split('\n')[0] ?? ''}`;
  return withPlanFileFooter(body, planFilePath);
}
