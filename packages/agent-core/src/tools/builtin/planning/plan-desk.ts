/**
 * Plan Desk — Conductor-lane planning delegates to a mission Job.
 *
 * Conductor must not run the structured-plan phase engine inline: its tool
 * waist lacks Write/WebSearch/… and ConductorDirectWorkGuard rejects file
 * mutation. EnterPlanMode / enterPlan RPC on the conductor lane create a
 * `kind=mission` Job (profile `plan`) and ACK immediately.
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
  readonly source?: 'standalone' | 'ultrawork';
  /** Optional title override (slash commands). */
  readonly title?: string;
}

export interface PlanDeskDelegateResult {
  readonly job: JobRecord;
  readonly output: string;
}

/** True when this agent is the interactive Conductor control plane. */
export function isConductorPlanDeskLane(agent: Agent): boolean {
  return agent.type === 'main' && agent.config.profileName === SOVEREIGN_CONDUCTOR_PROFILE_NAME;
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
  const prompt = buildPlanDeskBrief(context, input.ultra === true, input.source);

  const store = agent.tools.toolStore;
  const structured = input.ultra !== false;
  const job = createJob(store, {
    title,
    kind: 'mission',
    priority: 10,
    prompt,
    planStructured: structured,
  });

  requestJobSchedulePump({ store, agent });
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

function buildPlanDeskBrief(
  context: string,
  structured: boolean,
  source: PlanDeskDelegateInput['source'],
): string {
  const parts = [
    'You are a Plan Desk worker. Plan mode is activated on your agent at spawn.',
    structured
      ? [
          'Ultra/structured: Socratic interview until UltraGoal is verifiable (ambiguity ≤ 0.2), then write Seed Spec / AC Tree / WorkGraph / Evaluation / Execution to the plan file.',
          'Fast path: when the Goal is verifiable, call NextPhase({ phase: \'write\' }) — skip design/review unless architecture is still open.',
          'Research phase is optional; if already in interview, do not call EnterPlanMode again.',
        ].join(' ')
      : 'Regular: investigate with read-only tools, write a concrete step-by-step plan to the plan file, then ExitPlanMode for approval. No NextPhase.',
    'Ask clarifying questions with AskUserQuestion when user judgment is required (PATH 2). Prefer RecordInterviewFinding for code/research facts (PATH 1/3).',
    'Do not implement product code — planning only. Final summary: plan path, goal/AC, open risks.',
    source === 'ultrawork' ? 'Source: Mission / Ultrawork prepare.' : undefined,
    context.length > 0 ? `Task context:\n${context}` : 'Task context was not provided — infer from the session brief and repo.',
  ];
  return parts.filter(Boolean).join('\n\n');
}
