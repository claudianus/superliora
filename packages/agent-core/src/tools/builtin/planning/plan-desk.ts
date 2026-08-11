/**
 * Plan Desk — Conductor-lane planning delegates to a mission Job.
 *
 * Conductor must not run the structured-plan phase engine inline: its tool
 * waist lacks Write/WebSearch/… and ConductorDirectWorkGuard rejects file
 * mutation. EnterPlanMode / enterPlan RPC on the conductor lane create a
 * `kind=mission` Job (profile `plan`) and ACK immediately — but only once a
 * task context exists to brief the worker with; see
 * {@link shouldDelegateToPlanDesk}.
 */

import type { Agent } from '#/agent/index';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';

import {
  JOB_CREATE_ACK_SPAWN_GRACE_MS,
  requestJobSchedulePump,
  getJobWorkerSpawner,
} from '../../../session/job/job-offload';
import { createJob, getJob, renderJobLine, type JobRecord } from '../job/job-ledger';

export interface PlanDeskDelegateInput {
  readonly initialContext?: string;
  readonly ultra?: boolean;
  /** Optional title override (slash commands). */
  readonly title?: string;
}

export interface PlanDeskDelegateResult {
  readonly job: JobRecord;
  readonly output: string;
}

/**
 * True when planning should hand off to a Plan Desk job instead of running
 * inline: the interactive Conductor lane, and only once there is a task to
 * brief a worker with.
 *
 * Without context there is nothing to plan, so an explicit `/plan` or
 * `Session.setPlanMode(true)` activates plan mode on the lane and lets the
 * operator keep the plan file — same reasoning as session bootstrap.
 */
export function shouldDelegateToPlanDesk(agent: Agent, initialContext?: string): boolean {
  if (agent.type !== 'main' || agent.config.profileName !== SOVEREIGN_CONDUCTOR_PROFILE_NAME) {
    return false;
  }
  return (initialContext ?? '').trim().length > 0;
}

/**
 * Create a mission Job for structured planning and kick the offload pump.
 * Does not activate PlanMode on the conductor agent.
 */
export async function delegateConductorPlanDesk(
  agent: Agent,
  input: PlanDeskDelegateInput = {},
): Promise<PlanDeskDelegateResult> {
  const context = (input.initialContext ?? '').trim();
  const title = (input.title?.trim() || titleFromContext(context)).slice(0, 120);
  const prompt = buildPlanDeskBrief(context, input.ultra === true);

  const store = agent.tools.toolStore;
  const structured = input.ultra !== false;
  const job = createJob(store, {
    title,
    kind: 'mission',
    priority: 10,
    prompt,
    planStructured: structured,
  });

  void requestJobSchedulePump({ store, agent });
  if (agent.subagentHost !== undefined) {
    await Promise.race([
      getJobWorkerSpawner().settle(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, JOB_CREATE_ACK_SPAWN_GRACE_MS);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  const latest = getJob(store, job.id) ?? job;
  const kindLabel = structured ? 'ultra (structured interview)' : 'regular (free-form plan)';
  const lines = [
    `Plan Desk: ${kindLabel} delegated to a Job (Conductor does not run plan phases inline).`,
    `ACK ${latest.id} state=${latest.status}`,
    renderJobLine(latest),
    latest.worktreePath ? `worktree: ${latest.worktreePath}` : undefined,
    'Stay on the interactive lane: JobInbox for questions/results, JobSteer to redirect, JobCreate(implement) after the plan is approved.',
    'Do not call NextPhase/ExitPlanMode/Write on this lane — the plan worker owns the plan file.',
  ].filter(Boolean);

  return { job: latest, output: lines.join('\n') };
}

function titleFromContext(context: string): string {
  if (context.length === 0) return 'Plan Desk';
  const one = context.replace(/\s+/g, ' ').trim();
  if (one.length <= 72) return `Plan: ${one}`;
  return `Plan: ${one.slice(0, 64)}...`;
}

const HANDOFF_SHAPE =
  '## Implement handoff\nsuccess_criteria:\n- ...\nmust_not_touch:\n- ...\nverification_commands:\n- ...\nownership_paths:\n- ...\ncontext_paths:\n- ...\ntest_seams:\n- ...\ntdd_mode: preferred|required|off\ndelivery_mode: greenfield|standard';

/** Exported for tests — Plan Desk worker brief contract. */
export function buildPlanDeskBrief(context: string, structured: boolean): string {
  const parts = [
    'You are a Plan Desk worker. Plan mode is activated on your agent at spawn.',
    structured
      ? [
          'Ultra/structured: grill the design tree until UltraGoal is verifiable (ambiguity ≤ 0.2), then write Seed Spec / AC Tree / WorkGraph / Evaluation / Execution to the plan file.',
          'Grilling (this lane owns it — Conductor does not interview): map decisions as a design tree; each round ask the whole frontier via one AskUserQuestion card (number questions, include your recommended answer per question); wait for answers before the next round.',
          'Facts are your job: explore the codebase / RecordInterviewFinding for PATH 1/3 — never ask the user what you can look up. Decisions stay with the user.',
          'Sharpen fuzzy domain terms as they settle; put canonical names into the plan and into Implement handoff context_paths (include CONTEXT.md when it exists).',
          'Fast path: when the Goal is verifiable, call NextPhase({ phase: \'write\' }) — skip design/review unless architecture is still open.',
          'Research phase is optional; if already in interview, do not call EnterPlanMode again.',
          'Before ExitPlanMode, end the plan file AND your result summary with a machine-readable Implement handoff block exactly in this shape (lists may be empty only for ownership/context/verification/test_seams; success_criteria and must_not_touch must be non-empty for greenfield):',
          HANDOFF_SHAPE,
          'Also append wayfinder-lite sections when the effort is larger than one session: ## Destination, ## Decisions so far, ## Not yet specified (fog), ## Out of scope. Do not spawn implement Jobs while Not yet specified still blocks the finish line.',
        ].join(' ')
      : [
          'Regular: investigate with read-only tools, write a concrete step-by-step plan to the plan file, then ExitPlanMode for approval. No NextPhase.',
          'When the plan is ready, include an Implement handoff block in the result summary so Conductor can JobCreate without re-inventing the brief:',
          HANDOFF_SHAPE.replace('greenfield|standard', 'standard'),
        ].join(' '),
    'Ask clarifying questions with AskUserQuestion when user judgment is required (PATH 2). Prefer RecordInterviewFinding for code/research facts (PATH 1/3).',
    'If CONTEXT.md exists at the repo root (or under a relevant package), read it first and use its glossary in the plan and handoff.',
    'Do not implement product code — planning only. Final summary: plan path, goal/AC, open risks, then the Implement handoff block.',
    context.length > 0 ? `Task context:\n${context}` : 'Task context was not provided — infer from the session brief and repo.',
  ];
  return parts.filter(Boolean).join('\n\n');
}
