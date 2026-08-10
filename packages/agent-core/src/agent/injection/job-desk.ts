/**
 * Conductor Job desk injector — capped system injection of unread Job inbox.
 * Does not force a meta-loop kick; surfaces notices on the next inject cycle.
 */

import {
  listUnreadJobInbox,
  markJobInboxRead,
  type JobInboxEvent,
} from '#/tools/builtin/job/job-inbox';
import {
  DESK_DIGEST_TRIGGER_COUNT,
  runDeskDigestCycle,
} from '#/tools/builtin/job/job-desk';
import {
  getJob,
  listJobs,
  readJobLedger,
  renderJobLine,
  renderJobProgressSuffix,
  type JobRecord,
} from '#/tools/builtin/job/job-ledger';
import {
  formatJobStripLine,
  summarizeJobStrip,
} from '#/tools/builtin/job/job-runtime';
import {
  missionHasBlockingFog,
  parseImplementHandoff,
  textLooksLikePlanCompletion,
} from '#/tools/builtin/planning/implement-handoff';
import { UNVERIFIED_SUMMARY_PREFIX } from '#/session/subagent/subagent-result-contract';
import { parseModelFailedNote } from '#/session/subagent/subagent-model-failed-note';
import type { ToolStore } from '#/tools/store';

import { DynamicInjector } from './injector';

const JOB_DESK_VARIANT = 'conductor_job_desk';
export const JOB_DESK_POST_COMPACTION_VARIANT = 'conductor_job_post_compaction';
export const JOB_DESK_MAX_EVENTS = 5;
export const JOB_DESK_MAX_CHARS = 1_500;
export const JOB_DESK_MAX_LIVE = 4;
const JOB_DESK_POST_COMPACTION_MAX_JOBS = 6;

const POST_COMPACTION_STATUSES: ReadonlySet<JobRecord['status']> = new Set([
  'needs_user',
  'blocked',
  'running',
  'interrupted',
  'queued',
  'failed',
]);

export class JobDeskInjector extends DynamicInjector {
  protected override readonly injectionVariant = JOB_DESK_VARIANT;

  /**
   * Rebuild a read-only fleet snapshot at the compaction boundary. Normal desk
   * injection owns inbox delivery; this path only runs when no unread event
   * needs delivery, so it cannot consume or duplicate an inbox notice.
   */
  injectPostCompaction(): void {
    if (this.agent.type !== 'main') return;
    const text = renderConductorJobPostCompactionSnapshot(this.agent.tools.getStore());
    if (text === undefined) return;
    this.injectedAt = this.agent.context.history.length;
    this.agent.context.appendSystemReminder(text, {
      kind: 'injection',
      variant: JOB_DESK_POST_COMPACTION_VARIANT,
    });
  }

  protected override getInjection(): string | undefined {
    if (this.agent.type !== 'main') return undefined;
    const store = this.agent.tools.getStore();
    const unread = listUnreadJobInbox(store);
    const live = liveWorkerLines(store);
    if (unread.length === 0) {
      // Still show strip when in-flight jobs exist (no inbox spam).
      const strip = summarizeJobStrip(store);
      if (strip.running === 0 && strip.queued === 0 && strip.interrupted === 0 && strip.needsUser === 0) {
        return undefined;
      }
      // Throttle strip-only: once per injectedAt cycle is enough via DynamicInjector.
      if (this.injectedAt !== null) return undefined;
      return renderJobDeskInjection([], strip, { live, store });
    }

    // Contract §4.2 offloading: a burst is digested here (ledger-only, no
    // spawn) so the main turn sees exactly one escalation card instead of a
    // multi-event digest loop.
    if (unread.length >= DESK_DIGEST_TRIGGER_COUNT) {
      const cycle = runDeskDigestCycle(store);
      if (cycle.offloaded && cycle.escalation) {
        const strip = summarizeJobStrip(store);
        return renderJobDeskInjection([cycle.escalation], strip, {
          batched: cycle.batched,
          live,
          store,
        });
      }
    }

    const batch = unread.slice(0, JOB_DESK_MAX_EVENTS);
    const strip = summarizeJobStrip(store);
    const text = renderJobDeskInjection(batch, strip, { live, store });
    // Mark delivered so we do not re-inject every step (toast/TUI still have store).
    markJobInboxRead(
      store,
      batch.map((e) => e.id),
    );
    return text;
  }
}

export function renderConductorJobPostCompactionSnapshot(
  store: ToolStore,
): string | undefined {
  const unread = listUnreadJobInbox(store);
  if (unread.length > 0) return undefined;

  const strip = summarizeJobStrip(store);
  const jobs = readJobLedger(store).jobs
    .filter((job) => POST_COMPACTION_STATUSES.has(job.status))
    .toSorted(
      (a, b) =>
        b.priority - a.priority ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  if (jobs.length === 0) return undefined;

  const lines = [
    '<conductor_job_post_compaction>',
    'Read-only ledger snapshot after context compaction. The ledger is authoritative; inspect before claiming completion.',
    formatJobStripLine(strip),
    'Jobs:',
    ...jobs.slice(0, JOB_DESK_POST_COMPACTION_MAX_JOBS).map(renderJobLine),
  ];
  const nextMove = nextMoveGuidance([], strip, store);
  if (nextMove !== undefined) lines.push(`Next move: ${nextMove}`);
  lines.push('</conductor_job_post_compaction>');

  let text = lines.join('\n');
  if (text.length > JOB_DESK_MAX_CHARS) {
    const suffix = '\n… [truncated]\n</conductor_job_post_compaction>';
    text = `${text.slice(0, JOB_DESK_MAX_CHARS - suffix.length)}${suffix}`;
  }
  return text;
}

/**
 * Live progress lines for running workers (ledger `progress` mirrored from
 * the subagent reporter). Capped so a full pool cannot eat the inject budget.
 */
function liveWorkerLines(store: ToolStore): string[] {
  return listJobs(store)
    .filter((j) => j.status === 'running' && j.progress !== undefined)
    .slice(0, JOB_DESK_MAX_LIVE)
    .map((j) => `- ${j.id}${renderJobProgressSuffix(j)}`);
}

/** Exported for cap tests (V4-1); keep in sync with injector budget. */
export function renderJobDeskInjection(
  events: readonly JobInboxEvent[],
  strip: ReturnType<typeof summarizeJobStrip>,
  opts: {
    readonly batched?: number;
    readonly live?: readonly string[];
    readonly store?: ToolStore;
  } = {},
): string {
  const lines = [
    '<conductor_job_desk>',
    formatJobStripLine(strip, events.length),
  ];
  if (opts.batched !== undefined && opts.batched > 0) {
    lines.push(
      `inbox ${opts.batched} (batched) — burst offloaded to desk digest; one escalation card below.`,
    );
  }
  if (opts.live !== undefined && opts.live.length > 0) {
    lines.push('Live workers:');
    lines.push(...opts.live);
  }
  if (events.length > 0) {
    lines.push('Unread job notices (use JobInbox / JobInspect as needed):');
    for (const e of events) {
      lines.push(
        `- ${e.kind} ${e.jobId} [${e.status}] ${e.title}${e.summary ? ` — ${e.summary.slice(0, 100)}` : ''}`,
      );
    }
  } else {
    lines.push('In-flight Jobs present; interactive lane stays free for new instructions.');
  }
  const nextMove = nextMoveGuidance(events, strip, opts.store);
  if (nextMove !== undefined) lines.push(`Next move: ${nextMove}`);
  lines.push('</conductor_job_desk>');
  let text = lines.join('\n');
  if (text.length > JOB_DESK_MAX_CHARS) {
    const suffix = '\n… [truncated]\n</conductor_job_desk>';
    text = `${text.slice(0, JOB_DESK_MAX_CHARS - suffix.length)}${suffix}`;
  }
  return text;
}

/**
 * One severity-picked action line so the conductor routes instead of reciting
 * the board. This is where the per-state playbook lives: the static profile
 * prompt pays for every branch on every turn, while a desk line costs only
 * when the board is actually in that state. Stays one line to respect the
 * JOB_DESK_MAX_CHARS cap.
 */
function nextMoveGuidance(
  events: readonly JobInboxEvent[],
  strip: ReturnType<typeof summarizeJobStrip>,
  store?: ToolStore,
): string | undefined {
  if (events.some((e) => e.status === 'needs_user' || e.kind === 'job.needs_user') || strip.needsUser > 0) {
    return 'relay the worker question to the user now, then deliver the answer via JobResume(job_id, answer). This is the one state that interrupts whatever else you were doing.';
  }
  if (strip.failed > 1) {
    return 'repeated failures: stop retrying, diagnose from the ledger (JobInspect), then reframe with a smaller scope or escalate to the user with the evidence.';
  }
  const modelFailMove = modelFailedNextMove(events, store);
  if (modelFailMove !== undefined) return modelFailMove;
  if (events.some((e) => e.kind === 'job.failed') || strip.failed > 0) {
    return 'read each failure cause once (JobInspect), then retry once with a corrected brief or reframe — never blind-retry twice.';
  }
  if (events.some((e) => e.kind === 'job.blocked' || e.status === 'blocked') || strip.blocked > 0) {
    return 'blocked notes carry the cause (JobInspect): worktree/git setup, merge trust gap, spawn budget. Fix the cause, then JobResume — never resume blindly twice on the same one.';
  }
  if (events.some((e) => e.kind === 'job.interrupted') || strip.interrupted > 0) {
    return 'interrupted jobs restore safely with JobResume; worktrees survived.';
  }
  if (events.some((e) => e.summary?.startsWith(UNVERIFIED_SUMMARY_PREFIX) === true)) {
    return 'a done-claim landed with no checks run — delegate a verify Job before MergeJob; auto-approve holds without a green contract.';
  }
  const surfaceMove = surfaceContractNextMove(events, store);
  if (surfaceMove !== undefined) return surfaceMove;
  const planHandoffMove = planDeskHandoffNextMove(events, store);
  if (planHandoffMove !== undefined) return planHandoffMove;
  const goalDeskMove = goalDeskNextMove(events, store);
  if (goalDeskMove !== undefined) return goalDeskMove;
  if (events.some((e) => e.kind === 'job.completed')) {
    return 'verify done-claims against the brief; report the outcome; MergeJob if landing is wanted; PushJob / Push Preview for remote publish (never ask the user to paste git push).';
  }
  if (strip.queued > 0) {
    return 'queued work is waiting on a pool slot — report the order honestly (running, then queued) and raise priority instead of creating a duplicate.';
  }
  if (strip.running > 0) {
    return 'workers are live: steer only on real new information, never poll, and keep the lane free for the user.';
  }
  return undefined;
}

/** Model-route failure: steer Conductor to a different model_alias, not a blind retry. */
function modelFailedNextMove(
  events: readonly JobInboxEvent[],
  store: ToolStore | undefined,
): string | undefined {
  if (store === undefined) return undefined;
  for (const e of events) {
    if (e.kind !== 'job.failed' && e.status !== 'failed') continue;
    const job = getJob(store, e.jobId);
    if (job === undefined) continue;
    const parsed =
      parseModelFailedNote(job.notes) ??
      parseModelFailedNote(job.resultSummary) ??
      parseModelFailedNote(e.summary);
    if (parsed === undefined) continue;
    if (parsed.nextHint !== undefined) {
      return (
        `Job ${job.id} model failed (${parsed.alias}) — retry once with ` +
        `JobCreate/JobResume model_alias=${parsed.nextHint} (or omit for harness pick); ` +
        `do not blind-retry ${parsed.alias}.`
      );
    }
    return (
      `Job ${job.id} model failed (${parsed.alias}) tried=[${parsed.tried.join(',')}] — ` +
      'pick a different <fleet_model_catalog> alias or omit model_alias; do not blind-retry the same model.'
    );
  }
  // Board has failures but inbox events may already be marked read — scan ledger.
  if (store !== undefined) {
    for (const job of listJobs(store)) {
      if (job.status !== 'failed') continue;
      const parsed = parseModelFailedNote(job.notes) ?? parseModelFailedNote(job.resultSummary);
      if (parsed === undefined) continue;
      if (parsed.nextHint !== undefined) {
        return (
          `Job ${job.id} model failed (${parsed.alias}) — retry once with ` +
          `model_alias=${parsed.nextHint} (or omit); do not blind-retry ${parsed.alias}.`
        );
      }
      return (
        `Job ${job.id} model failed (${parsed.alias}) — pick another catalog alias or omit model_alias.`
      );
    }
  }
  return undefined;
}

/**
 * Surface/verify contract gaps — route Conductor to JobSteer / requeue, not
 * path-regex inventing a VerifySurface requirement.
 */
function surfaceContractNextMove(
  events: readonly JobInboxEvent[],
  store: ToolStore | undefined,
): string | undefined {
  if (store === undefined) return undefined;
  for (const e of events) {
    if (e.kind !== 'job.completed' && e.status !== 'done') continue;
    const job = getJob(store, e.jobId);
    if (job === undefined) continue;
    if (job.kind !== 'task' && job.kind !== 'implement') continue;
    if (job.surfaceKind === undefined) {
      return (
        `Job ${job.id} is done without surface_kind — JobSteer(surface_kind=none|web|tui|mixed) before MergeJob; ` +
        'do not invent a web VerifySurface gate from path regex.'
      );
    }
    if (
      (job.surfaceKind === 'web' || job.surfaceKind === 'tui' || job.surfaceKind === 'mixed') &&
      job.resultContract?.verification.visual !== 'passed'
    ) {
      const proof =
        job.surfaceKind === 'tui'
          ? 'TUI smoke (`pnpm -C apps/liora run smoke:visual`)'
          : 'VerifySurface (web) / matching surface proof';
      return (
        `Job ${job.id} surface_kind=${job.surfaceKind} lacks visual=passed — requeue/steer for ${proof}; ` +
        'force_user_confirm cannot bypass visual proof.'
      );
    }
  }
  // verify child done without structured verdict
  for (const e of events) {
    if (e.kind !== 'job.completed' && e.status !== 'done' && e.kind !== 'job.failed') continue;
    const job = getJob(store, e.jobId);
    if (job === undefined || job.kind !== 'verify') continue;
    if (job.verifyVerdict === undefined) {
      return (
        `Verify Job ${job.id} finished without structured verifyVerdict — JobInspect the summary; ` +
        'requeue verify to emit dual-axis JSON so MergeJob does not see verdict=missing.'
      );
    }
  }
  return undefined;
}

/** Goal Desk / driver terminal notices — keep Conductor out of the goal loop. */
function goalDeskNextMove(
  events: readonly JobInboxEvent[],
  store: ToolStore | undefined,
): string | undefined {
  if (store === undefined) return undefined;
  for (const e of events) {
    if (
      e.kind !== 'job.completed' &&
      e.kind !== 'job.failed' &&
      e.kind !== 'job.needs_user' &&
      e.status !== 'needs_user'
    ) {
      continue;
    }
    const job = getJob(store, e.jobId);
    if (job === undefined) continue;
    if (job.kind !== 'goal-desk' && job.kind !== 'goal-driver') continue;
    if (e.kind === 'job.needs_user' || e.status === 'needs_user') {
      return `Goal Job ${job.id} needs the user — relay via AskUserQuestion / JobResume, do not pursue the goal on this lane.`;
    }
    if (e.kind === 'job.failed' || job.status === 'failed' || job.status === 'blocked') {
      return `Goal Job ${job.id} stopped (${job.status}) — JobInspect, then /goal resume or replace; do not run driveGoal on Conductor.`;
    }
    if (e.kind === 'job.completed') {
      return `Goal Job ${job.id} finished — report the outcome from JobInspect; MergeJob only if a landable implement branch exists.`;
    }
  }
  return undefined;
}

/** Prefer Implement-handoff JobCreate after a Plan Desk mission completes. */
function planDeskHandoffNextMove(
  events: readonly JobInboxEvent[],
  store: ToolStore | undefined,
): string | undefined {
  if (store === undefined) return undefined;
  for (const e of events) {
    if (e.kind !== 'job.completed' && e.status !== 'done') continue;
    const job = getJob(store, e.jobId);
    if (job === undefined || job.kind !== 'mission') continue;
    const summary = job.resultSummary ?? e.summary ?? '';
    if (missionHasBlockingFog(summary)) {
      return (
        `Plan Desk ${job.id} still has wayfinder fog (## Not yet specified) — ` +
        'do not JobCreate(implement); EnterPlanMode / explore to clear decisions first.'
      );
    }
    const handoff = parseImplementHandoff(summary);
    if (handoff !== undefined) {
      const seamHint =
        handoff.testSeams.length > 0 || handoff.tddMode !== undefined
          ? ' Copy test_seams / tdd_mode from the draft.'
          : '';
      return (
        `Plan Desk ${job.id} finished with an Implement handoff — JobInspect for the draft, ` +
        `present it, then JobCreate from those fields` +
        (handoff.deliveryMode === 'greenfield'
          ? ' (delivery_mode=greenfield, greenfield_chain=true).'
          : '.') +
        seamHint
      );
    }
    if (textLooksLikePlanCompletion(summary) || job.planStructured !== false) {
      return (
        `Plan Desk ${job.id} finished but the Implement handoff block is missing — ` +
        'JobSteer the plan worker (or re-run Plan Desk) to add ## Implement handoff before spawning implement Jobs.'
      );
    }
  }
  return undefined;
}
