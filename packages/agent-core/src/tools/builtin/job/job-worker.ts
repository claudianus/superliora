/**
 * Conductor Job → subagent worker launch (P1.5).
 * Spawns a background subagent in the job worktree and patches the ledger on completion.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { Agent } from '../../../agent/index';
import { type FanoutSpec, type FanoutTask, spawnOneAgent } from '../../../fleet/spawn-agents';
import { pushJobInboxEvent } from './job-inbox';
import { emitJobEvents, inboxToWireEvent } from './job-emit';
import {
  classifyObjectiveProfile,
  uiSpawnQualityFlags,
} from '../../../premium-quality';
import { requestJobSchedulePump } from '../../../session/job/job-offload';
import {
  isSubagentDeadlineError,
  resolveJobWorkerLaunchTimeoutMs,
} from '../../../session/subagent/subagent-host';
import type { SubagentCompletion } from '../../../session/subagent/subagent-host-types';
import { renderFrictionSection } from '../../../session/subagent/subagent-friction';
import {
  UNVERIFIED_SUMMARY_PREFIX,
  verificationIsUnverified,
} from '../../../session/subagent/subagent-result-contract';
import { applySurfaceKindToContract, surfaceRequiresVisualProof } from './job-surface';
import { parseVerifyVerdict } from './job-verify-chain';
import { userCancellationReason } from '../../../utils/abort';
import type { ToolStore } from '../../store';
import {
  clearJobWorkerHandle,
  getJobWorkerHandle,
  registerJobWorkerHandle,
  setJobWorkerAgentId,
  abortJobWorker as abortRegisteredJobWorker,
} from './job-handles';
import {
  armJobWorkerProgressStall,
  bindJobWorkerLedger,
  buildDeadlineFailureSummary,
  unbindJobWorkerLedger,
} from './job-worker-ledger-bridge';
import { syncGoalDeskParentFromDriver } from '../goal/goal-session-binding';
import { EXPERT_CATALOG_BY_ID } from '../../../expert-agents/catalog';
import { buildExpertAssignmentPrompt } from '../../../expert-agents/expert-persona';
import { globalExpertSearchEngine } from '../../../expert-agents/search';
import {
  renderDeliveryPhaseContract,
  renderStructuredBriefSections,
} from './job-brief';
import { runMergeLandJob, type LandJobToMainInput } from './job-land';
import { getJob, listJobs, patchJob, type JobRecord, type JobStatus } from './job-ledger';
import { notifyJobTerminal, patchJobAndNotify } from './job-notify';
import {
  holderJobIdFromOwnershipError,
  isOwnershipConflictError,
  ownershipDeferredNote,
} from './job-ownership';
import { runPushRemoteJob } from './job-push';
import { onJobTerminalForVerifyChain } from './job-verify-chain';
import { preflightJobWorkerModel } from './job-model-live';
import { profileForJobKind } from './job-runtime';
import { commitJobWorktreeIfDirty } from './job-worktree-commit';

export interface LaunchJobWorkerInput {
  readonly store: ToolStore;
  readonly agent: Agent;
  /** Injectable git runner for kind=merge land / kind=push (tests). */
  readonly runGit?: LandJobToMainInput['runGit'];
  readonly job: JobRecord;
  readonly signal?: AbortSignal;
  /** Inject spawn for unit tests. */
  readonly spawnOne?: typeof spawnOneAgent;
}

export interface LaunchJobWorkerResult {
  readonly ok: boolean;
  readonly workerAgentId?: string;
  readonly error?: string;
}

/** Cap for the parent job's result summary carried into a child worker prompt. */
export const JOB_PRIOR_FINDINGS_MAX_CHARS = 2000;

function visualDodLines(job: JobRecord): readonly string[] {
  if (job.kind === 'verify' || job.kind === 'explore' || job.kind === 'research') return [];
  const kind = job.surfaceKind;
  if (kind === 'web' || kind === 'mixed') {
    return [
      `- Visual DoD (${kind} surface): write a short Art Direction Brief before first markup; Skill("premium-visual") before shipping a visible slice; call VerifySurface once on the real surface before done (≤2 min fail-fast). VerifySurface requires load+interaction+craft axes; BrowserScreenshot alone does not set visual=passed. If the runtime is not ready, report visual failed — do not BrowserAct-explore or reinstall loops. Record screenshot path in the summary. MergeJob hard-fails without visual=passed.`,
      ...(kind === 'mixed'
        ? [
            '- Also land TUI visual smoke (`pnpm -C apps/liora run smoke:visual` or equivalent) before done — mixed surfaces need both web and TUI proof.',
          ]
        : []),
    ];
  }
  if (kind === 'tui') {
    return [
      '- Visual DoD (tui surface): prove the real ANSI surface — run `pnpm -C apps/liora run smoke:visual` (or the brief verification_commands smoke) and cite the artifact under `.superliora/visual-smoke/`. VerifySurface is N/A for TUI. MergeJob hard-fails without visual=passed from smoke.',
    ];
  }
  // surfaceKind none/undefined: no Visual DoD. PQ soft hints may still apply via spawn flags.
  return [];
}

/** Media asset loop for implement/task/goal-driver — tools are key-gated on the worker. */
function mediaDodLines(job: JobRecord): readonly string[] {
  if (job.kind !== 'task' && job.kind !== 'implement' && job.kind !== 'goal-driver') return [];
  return [
    '- Media DoD (when the brief asks for assets): GenerateImage/GenerateVideo with provider=auto (or only a ready id from media_readiness) → ReadMediaFile → place real paths under the workspace; keep one style seed across related assets. Do not force qwen/openai/google without that backend. If those tools are absent from your tool list, stop blocked with key evidence — do not fake assets as done.',
  ];
}

export function jobPrompt(job: JobRecord, store?: ToolStore): string {
  const parentFindings = priorFindingsForJob(job, store);
  const expertBlock = renderJobExpertBlock(job);
  const parts = [
    `You are a Conductor worker for job ${job.id}.`,
    expertBlock,
    `Title: ${job.title}`,
    job.goalObjective
      ? [
          'This job owns an autonomous goal. The runtime created it on your agent —',
          'do not create or replace it; pursue it across turns until done.',
          `Objective: ${job.goalObjective}`,
          job.goalCompletionCriterion
            ? `Completion criterion: ${job.goalCompletionCriterion}`
            : undefined,
          job.goalGateCommand
            ? `Gate command (must exit 0 before complete): \`${job.goalGateCommand}\``
            : undefined,
          'Report the outcome through UpdateGoal: complete when the criterion is met',
          '(with verification evidence), blocked when an external blocker stops you.',
        ]
          .filter(Boolean)
          .join('\n')
      : undefined,
    job.kind === 'mission'
      ? job.planStructured === false
        ? [
            'Plan Desk (regular): plan mode is active — write a concrete plan file, then ExitPlanMode.',
            'Do not call EnterPlanMode or NextPhase. Do not implement product code.',
          ].join('\n')
        : [
            'Plan Desk (ultra): structured plan mode is already active.',
            'Do not call EnterPlanMode again. Use NextPhase / AskUserQuestion / RecordInterviewFinding.',
            'When UltraGoal is verifiable, prefer NextPhase({ phase: \'write\' }) over design/review.',
            'Write only to the plan file, then ExitPlanMode. Do not implement product code.',
          ].join('\n')
      : undefined,
    job.kind === 'explore' && /\bprototype\b/i.test(`${job.title}\n${job.prompt ?? ''}`)
      ? [
          'Prototype explore: build throwaway code that answers ONE design question.',
          'Mark it clearly as prototype; keep it trivial to run; no persistence by default; skip polish/tests.',
          'Capture the verdict + question settled in the summary; leave a context pointer (branch/path). Do not merge prototype code to main as product.',
          'Skill("prototype") for LOGIC vs UI branch details.',
        ].join('\n')
      : undefined,
    renderDeliveryPhaseContract(job.deliveryPhase),
    renderStructuredBriefSections(job),
    job.prompt?.trim() ? `Brief:\n${job.prompt.trim()}` : undefined,
    job.contextPaths?.length
      ? `Read these first: ${job.contextPaths.join(', ')}`
      : undefined,
    'Domain glossary: if CONTEXT.md exists at the repo root (or under a touched package), read it before naming things — use its terms; do not invent synonyms.',
    parentFindings,
    job.ownershipPaths?.length
      ? `Preferred paths: ${job.ownershipPaths.join(', ')}`
      : undefined,
    job.worktreePath
      ? `You are running in an isolated worktree: ${job.worktreePath}. Do not push to remotes — finish with a publishable summary (branch/sha/remote_ref) so Conductor can call PushJob / open Push Preview.`
      : undefined,
    renderRecoveryBriefAppendix(job),
    job.taskTrack === 'general' && (job.kind === 'task' || job.kind === 'implement')
      ? [
          'Worker contract (general track):',
          '- Execute the install / OS / app request. Do not create a worktree, run git commit, open a release PR, or run pnpm run gate.',
          '- Keep secrets blocked: never Read/Write/Edit .env, SSH keys, or credential files (PATH_SENSITIVE still applies).',
          '- Destructive OS changes and package installs still need user approval evidence before claiming pass.',
          '- Final summary MUST include JSON: {"generalVerdict":"passed"|"failed","proof":"<command exit or observation>"}.',
          '- If blocked (env, missing info, contradiction), stop with a concrete blocker and what you tried — do not invent.',
        ].join('\n')
      : [
          'Worker contract:',
          ...(job.kind === 'verify'
            ? [
                job.surfaceKind === 'tui'
                  ? '- Verify DoD: do not implement product features. Inspect the parent diff/summary against success criteria and test seams; run verification_commands when set; for TUI confirm visual smoke evidence (VerifySurface is N/A). Final summary MUST include dual-axis JSON: {"verdict":"pass"|"fail","standards":{"verdict":"pass"|"fail","findings":[]},"spec":{"verdict":"pass"|"fail","findings":[]},"findings":[],"required_fixes":[]}. Overall pass only when both axes pass.'
                  : '- Verify DoD: do not implement product features. Inspect the parent diff/summary against success criteria and test seams; run verification_commands when set; for web surfaces call VerifySurface when a URL/HTML path exists. Final summary MUST include dual-axis JSON: {"verdict":"pass"|"fail","standards":{"verdict":"pass"|"fail","findings":[]},"spec":{"verdict":"pass"|"fail","findings":[]},"findings":[],"required_fixes":[]}. Overall pass only when both axes pass.',
              ]
            : job.kind === 'research'
              ? [
                  '- Research DoD: prefer DeepResearch / WebSearch / FetchURL / Context7 over multi-file code marathons. Cite sources. Do not edit the product tree.',
                ]
              : job.kind === 'explore'
                ? [
                    '- Explore DoD: read-only codebase discovery. Prefer RepoQuery/Grep/Read; report findings structured. Do not edit the product tree.',
                  ]
                : [
                    '- Trace the brief against the codebase before editing (callers / fail path / success criteria).',
                    '- Prefer the smallest diff that meets success criteria; stay inside ownership/context paths when set.',
                    '- After each meaningful change, run focused checks when available; cite that evidence in the result summary.',
                  ]),
          ...tddContractLines(job),
          ...(job.kind === 'implement' && job.title.startsWith('Debug:')
            ? debugContractLines(job)
            : []),
          ...visualDodLines(job),
          ...mediaDodLines(job),
          ...(job.worktreePath !== undefined &&
          job.kind !== 'verify' &&
          job.kind !== 'explore' &&
          job.kind !== 'research'
            ? [
                '- Commit your work in the job worktree before finishing (`git add -A && git commit`; local commits only, never push). This brief explicitly authorizes those commits — no confirmation loop needed. Land-to-main / PushJob use the branch tip, so uncommitted changes are invisible and lost at worktree GC.',
              ]
            : []),
          '- If blocked (env, missing info, contradiction), stop with a concrete blocker and what you tried — do not invent.',
          '- Final summary: what changed, how verified, what remains. If remote publish is needed, include branch name and suggested remote_ref (e.g. gh-pages) for PushJob.',
        ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Soft continuity for crash/resume cold relaunch: last progress, interrupt
 * reason, worktree HEAD/status, and a no-rewrite guard. Shown when notes
 * mention interrupt/resume or a checkpoint id is retained.
 */
export function renderRecoveryBriefAppendix(job: JobRecord): string | undefined {
  const notes = job.notes ?? '';
  const isRecovery =
    /\binterrupt:/i.test(notes) ||
    /\bresume:/i.test(notes) ||
    job.workerResumeAgentId !== undefined;
  if (!isRecovery) return undefined;

  const interruptLine = notes
    .split('\n')
    .reverse()
    .find((line) => /\binterrupt:/i.test(line) || /\bresume:/i.test(line));
  const progress = job.progress;
  const progressBits: string[] = [];
  if (progress?.phase) progressBits.push(`phase=${progress.phase}`);
  if (progress?.recentTools && progress.recentTools.length > 0) {
    progressBits.push(`recentTools=${progress.recentTools.slice(0, 5).join(',')}`);
  }
  if (progress?.lastHeartbeatAt) progressBits.push(`heartbeat=${progress.lastHeartbeatAt}`);

  const parts = [
    '## Crash / resume continuity',
    'Continue from the worktree as-is. Do not rewrite changes already present; finish the brief.',
    interruptLine !== undefined ? `Last interrupt/resume note: ${interruptLine.trim()}` : undefined,
    progressBits.length > 0 ? `Last progress: ${progressBits.join(' · ')}` : undefined,
    job.workerResumeAgentId !== undefined
      ? `Prior worker id (checkpoint): ${job.workerResumeAgentId}${job.workerCheckpointAt ? ` @ ${job.workerCheckpointAt}` : ''}`
      : undefined,
    job.resultSummary?.trim()
      ? `Prior result summary (may be partial):\n${job.resultSummary.trim().slice(0, 1200)}`
      : undefined,
    snapshotWorktreeForRecovery(job.worktreePath),
  ];
  return parts.filter(Boolean).join('\n');
}

function snapshotWorktreeForRecovery(worktreePath: string | undefined): string | undefined {
  if (worktreePath === undefined || worktreePath.trim().length === 0) return undefined;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 3_000,
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 3_000,
      maxBuffer: 64_000,
    }).trim();
    const dirty = status
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 20);
    return [
      `Worktree HEAD: ${sha}`,
      dirty.length > 0 ? `Dirty paths:\n${dirty.join('\n')}` : 'Worktree clean.',
    ].join('\n');
  } catch {
    return `Worktree path retained: ${worktreePath} (git status unavailable).`;
  }
}

function tddContractLines(job: JobRecord): readonly string[] {
  if (job.kind === 'verify' || job.kind === 'research' || job.kind === 'explore') return [];
  if (job.kind === 'implement' && job.title.startsWith('Debug:')) return [];
  if (job.kind !== 'task' && job.kind !== 'implement') return [];
  const mode = job.tddMode ?? 'preferred';
  if (mode === 'off') return [];
  const seams =
    job.testSeams !== undefined && job.testSeams.length > 0
      ? job.testSeams.join('; ')
      : undefined;
  const lines = [
    mode === 'required'
      ? '- TDD DoD (required): write a failing test at a pre-agreed seam before implementation; no green without red. Skill("tdd") for seam/anti-pattern reference only.'
      : '- TDD DoD (preferred): prefer red→green at public seams; avoid tautological or implementation-coupled tests. Skill("tdd") for seam/anti-pattern reference only.',
  ];
  if (seams !== undefined) {
    lines.push(`- Test only at these seams: ${seams}. Do not invent unconfirmed seams.`);
  }
  return lines;
}

function debugContractLines(job: JobRecord): readonly string[] {
  const repro = job.reproCommand?.trim();
  return [
    '- Debug DoD (diagnosing Phase 1 first): build a tight red-capable feedback loop for the user symptom before hypothesising. Skill("diagnosing-bugs") for the full loop only.',
    repro !== undefined && repro.length > 0
      ? `- Known repro command: \`${repro}\` — run it, show redacted output, then minimise before fixing.`
      : '- No repro_command yet — invent/run one agent-runnable command that goes red on this bug; record repro_command + repro_output in the summary before any fix.',
    '- After a red loop exists: minimise → falsifiable hypotheses → smallest fix → re-verify. Do not expand scope or ship unrelated features.',
  ];
}

function renderJobExpertBlock(job: JobRecord): string | undefined {
  const expertId = job.expertId?.trim();
  if (expertId === undefined || expertId.length === 0) return undefined;
  const expert =
    globalExpertSearchEngine.getExpertById(expertId) ?? EXPERT_CATALOG_BY_ID[expertId];
  if (expert === undefined) {
    return [
      `Staffed expert id: ${expertId}`,
      `Job kind: ${job.kind}`,
      job.expertScore !== undefined ? `Staff score: ${String(job.expertScore)}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    buildExpertAssignmentPrompt(expert, {
      taskDescription: job.prompt ?? job.title,
      selectionReason: job.staffQuery,
      phase: job.kind,
    }),
    `Job kind: ${job.kind}`,
    job.expertScore !== undefined ? `Staff score: ${String(job.expertScore)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Carry the parent job's result summary into a child worker prompt so
 * explore→implement chains do not lose findings to manual copying.
 */
function priorFindingsForJob(job: JobRecord, store?: ToolStore): string | undefined {
  if (store === undefined || job.parentJobId === undefined) return undefined;
  const parent = getJob(store, job.parentJobId);
  if (parent === undefined) return undefined;
  const summary = parent.resultSummary?.trim();
  const factLines = contractFactLines(parent.resultContract);
  if ((summary === undefined || summary.length === 0) && factLines.length === 0) {
    return undefined;
  }
  const cappedSummary =
    summary === undefined || summary.length === 0
      ? undefined
      : summary.length > JOB_PRIOR_FINDINGS_MAX_CHARS
        ? `${summary.slice(0, JOB_PRIOR_FINDINGS_MAX_CHARS)}\n[truncated]`
        : summary;
  const body = [cappedSummary, ...factLines].filter(Boolean).join('\n');
  return `Prior findings from parent job ${parent.id}:\n${body}`;
}

/** Structured handoff facts from the worker contract (files changed, verification). */
function contractFactLines(
  contract: JobRecord['resultContract'],
): readonly string[] {
  if (contract === undefined) return [];
  const lines: string[] = [];
  if (contract.files_changed.length > 0) {
    const shown = contract.files_changed.slice(0, 10).join(', ');
    const more =
      contract.files_changed.length > 10
        ? ` (+${contract.files_changed.length - 10} more)`
        : '';
    lines.push(`Files changed: ${shown}${more}`);
  }
  const v = contract.verification;
  lines.push(
    `Verification: tests=${v.tests}, typecheck=${v.typecheck}, lint=${v.lint}, visual=${v.visual ?? 'not_run'}`,
  );
  return lines;
}

function isTerminalOrCancelled(status: JobStatus): boolean {
  return (
    status === 'cancelled' ||
    status === 'done' ||
    status === 'failed' ||
    status === 'interrupted'
  );
}

/**
 * Snapshot a dirty job worktree at worker completion/failure (commit
 * backstop — see job-worktree-commit). Returns the ledger note line, or
 * undefined when the tree was clean or no git path exists. Never throws into
 * the completion path.
 */
async function snapshotWorkerWorktree(
  agent: Agent,
  job: JobRecord,
): Promise<string | undefined> {
  if (job.worktreePath === undefined || agent.kaos === undefined) return undefined;
  try {
    const result = await commitJobWorktreeIfDirty({
      kaos: agent.kaos,
      worktreePath: job.worktreePath,
      jobId: job.id,
      jobTitle: job.title,
    });
    if (result.committed) return 'commit: snapshotted dirty worktree (worker had not committed)';
    return result.error !== undefined ? `commit_failed: ${result.error}` : undefined;
  } catch (error) {
    return `commit_failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Launch a background subagent for a job that is already `running` with worktree assigned.
 * Completion updates ledger, meta inbox, and pumps the scheduler for the next queued jobs.
 *
 * Lane contract: spawn may await briefly for handle registration, but worker
 * lifetime is fire-and-forget (`void handle.completion`) so the meta turn is not blocked.
 */
export async function launchJobWorker(input: LaunchJobWorkerInput): Promise<LaunchJobWorkerResult> {
  let job = getJob(input.store, input.job.id) ?? input.job;
  if (job.status !== 'running') {
    return { ok: false, error: `job not running: ${job.status}` };
  }

  // Goal Desk v1: ledger umbrella only — child goal-driver owns the LLM loop.
  // No subagentHost required (desk never spawns an LLM worker). Pump so the
  // driver (parent=desk) is not left queued forever under a running umbrella.
  if (job.kind === 'goal-desk') {
    patchJob(input.store, job.id, {
      notes: [job.notes, 'goal-desk: umbrella (no worker; drivers execute)']
        .filter(Boolean)
        .join('\n'),
    });
    pumpSchedulerAfterWorker(input.agent, input.store);
    return { ok: true };
  }

  // Merge landing: deterministic git land on the source worktree — never an LLM.
  if (job.kind === 'merge') {
    // Ledger owns done/blocked; do not surface land failure as spawn_failed.
    await runMergeLandJob({
      store: input.store,
      mergeJob: job,
      kaos: input.agent.kaos,
      repoPath: input.agent.config.cwd,
      runGit: input.runGit,
      agent: input.agent,
    });
    pumpSchedulerAfterWorker(input.agent, input.store);
    return { ok: true };
  }

  // Remote push: deterministic git push on the source worktree — never an LLM.
  // remoteRef may be omitted in the prompt; runPushRemoteJob infers gh-pages
  // (etc.) from push/source job titles and briefs.
  if (job.kind === 'push') {
    const remoteMatch = /\bremote:\s*(\S+)/i.exec(job.prompt ?? '');
    const localMatch = /\blocalRef:\s*(\S+)/i.exec(job.prompt ?? '');
    const remoteRefMatch = /\bremoteRef:\s*(\S+)/i.exec(job.prompt ?? '');
    await runPushRemoteJob({
      store: input.store,
      pushJob: job,
      kaos: input.agent.kaos,
      repoPath: input.agent.config.cwd,
      runGit: input.runGit,
      agent: input.agent,
      remote: remoteMatch?.[1] ?? 'origin',
      localRef: localMatch?.[1],
      remoteRef: remoteRefMatch?.[1],
    });
    pumpSchedulerAfterWorker(input.agent, input.store);
    return { ok: true };
  }

  const host = input.agent.subagentHost;
  if (host === undefined) {
    return { ok: false, error: 'subagentHost unavailable' };
  }

  const controller = new AbortController();
  registerJobWorkerHandle(job.id, controller);

  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort(input.signal.reason);
    } else {
      input.signal.addEventListener('abort', () => controller.abort(input.signal?.reason), {
        once: true,
      });
    }
  }

  if (controller.signal.aborted) {
    clearJobWorkerHandle(job.id);
    return { ok: false, error: 'aborted before spawn' };
  }

  const profileName = profileForJobKind(job.kind);
  const objectiveBlob = [job.title, job.prompt, job.goalObjective].filter(Boolean).join('\n');
  if (objectiveBlob.trim().length > 0 && input.agent.objectiveProfile !== undefined) {
    input.agent.objectiveProfile.set(
      objectiveBlob,
      classifyObjectiveProfile(objectiveBlob, [
        ...(job.contextPaths ?? []),
        ...(job.ownershipPaths ?? []),
      ]),
    );
  }
  // PQ soft hint only — merge/verify gates key off surfaceKind, not this regex.
  const uiFlags =
    job.surfaceKind === 'web' || job.surfaceKind === 'mixed' || job.surfaceKind === 'tui'
      ? ({ forcePremiumQuality: true as const, preferVisionModel: true as const } as const)
      : job.surfaceKind === 'none'
        ? undefined
        : uiSpawnQualityFlags({
            title: job.title,
            prompt: job.prompt,
            goalObjective: job.goalObjective,
            contextPaths: job.contextPaths,
            ownershipPaths: job.ownershipPaths,
          });

  // Live probe before spawn — do not attach a worker to a quota/auth-dead alias.
  const modelPreflight = await preflightJobWorkerModel(input.agent, job, {
    signal: controller.signal,
    preferVision: uiFlags?.preferVisionModel === true,
  });
  if (!modelPreflight.ok) {
    clearJobWorkerHandle(job.id);
    const detail = modelPreflight.error;
    // Model/quota blockers are resumable — `blocked` (not `failed`) so
    // /goal resume and JobResume re-queue after /model or provider recovery.
    // Heal treats `blocked` as live, so mirror Goal Desk immediately.
    const updated = patchJob(input.store, job.id, {
      status: 'blocked',
      resultSummary: detail.slice(0, 2000),
      notes: [job.notes, modelPreflight.note, `spawn_blocked: ${detail}`]
        .filter(Boolean)
        .join('\n'),
    });
    if (updated) {
      syncGoalDeskParentFromDriver(input.store, updated, input.agent);
      notifyJobTerminal({
        store: input.store,
        job: updated,
        status: 'blocked',
        summary: detail,
        agent: input.agent,
      });
    }
    return { ok: false, error: detail };
  }
  if (
    modelPreflight.modelAlias !== undefined &&
    modelPreflight.modelAlias !== job.modelAlias
  ) {
    patchJob(input.store, job.id, { modelAlias: modelPreflight.modelAlias });
    job = { ...job, modelAlias: modelPreflight.modelAlias };
  }

  const baseTaskFields = {
    prompt: jobPrompt(job, input.store),
    description: job.title.slice(0, 80),
    profileName,
    // verify / explore / research never take exclusive write leases (belt +
    // suspenders for manually created Jobs that still set ownershipPaths).
    ownership:
      job.kind === 'verify' || job.kind === 'explore' || job.kind === 'research'
        ? undefined
        : job.ownershipPaths
          ? [...job.ownershipPaths]
          : undefined,
    worktreeDir: job.worktreePath,
    // Visual surface Jobs force Premium Quality ON even when the Conductor toggle is OFF.
    forcePremiumQuality: uiFlags?.forcePremiumQuality,
    // Text-only coding models cannot audit screenshots; prefer a vision alias.
    preferVisionModel: uiFlags?.preferVisionModel,
    // Conductor-picked / live-probed worker model; omit → role smart route.
    modelAlias: modelPreflight.modelAlias ?? job.modelAlias,
    // Goal-driver (spec 2026-08-04-goal-driver-jobs): the goal migrates onto
    // the worker, whose turn engine then runs the autonomous loop. The brief
    // doubles as the objective; JobCreate validated its length.
    goal:
      job.kind === 'goal-driver'
        ? {
            objective: job.goalObjective ?? job.prompt?.trim() ?? job.title,
            completionCriterion: job.goalCompletionCriterion,
            ...(job.goalGateCommand !== undefined
              ? { gateCommand: job.goalGateCommand }
              : {}),
            budgetLimits: job.goalBudgetLimits,
          }
        : undefined,
    // Plan Desk: plan mode on the plan-profile worker (not Conductor).
    plan:
      job.kind === 'mission'
        ? {
            ultra: job.planStructured !== false,
            initialContext: job.prompt?.trim() || job.title,
            planId: `job-${job.id}`,
          }
        : undefined,
  } as const;
  const resumeAgentId = job.workerResumeAgentId?.trim() || undefined;
  const task: FanoutTask = {
    ...baseTaskFields,
    ...(resumeAgentId !== undefined ? { resumeAgentId } : {}),
  };
  const parentToolCallId = `job:${job.id}:${randomUUID().slice(0, 8)}`;
  // Mission (Plan Desk) uses the longer plan-desk budget; implement/verify stay 30m.
  // Resume inherits spent wall-clock from workerDeadlineStartedAt (never full reset).
  // Exhausted remaining is 1ms — never timeoutMs:0 (that is the env kill-switch).
  const workerTimeoutMs = resolveJobWorkerLaunchTimeoutMs(
    job.kind,
    job.workerDeadlineStartedAt,
  );
  const spec: FanoutSpec = {
    mode: 'manual',
    parentToolCallId,
    runInBackground: true,
    signal: controller.signal,
    timeoutMs: workerTimeoutMs,
    tasks: [task],
  };

  const spawn = input.spawnOne ?? spawnOneAgent;

  try {
    let handle;
    let reattached = false;
    try {
      handle = await spawn(host, spec, task);
      reattached = resumeAgentId !== undefined && handle.resumed === true;
    } catch (resumeError: unknown) {
      if (resumeAgentId === undefined) throw resumeError;
      // Checkpoint reattach failed — cold spawn with soft-continuity brief.
      const failSummary =
        resumeError instanceof Error ? resumeError.message : String(resumeError);
      const inboxEvent = pushJobInboxEvent(input.store, {
        kind: 'recovery.reattach_failed',
        jobId: job.id,
        status: job.status,
        title: job.title,
        summary: `reattach ${resumeAgentId} failed: ${failSummary.slice(0, 240)}; cold spawn`,
      });
      emitJobEvents(input.agent, [inboxToWireEvent(inboxEvent)]);
      const coldTask: FanoutTask = { ...baseTaskFields };
      handle = await spawn(host, { ...spec, tasks: [coldTask] }, coldTask);
      reattached = false;
    }
    setJobWorkerAgentId(job.id, handle.agentId);
    bindJobWorkerLedger(handle.agentId, input.store, job.id, input.agent);
    // Post-spawn progress stall (120s): independent of the 30s handshake budget.
    const disposeProgressStall = armJobWorkerProgressStall(handle.agentId);
    const nowIso = new Date().toISOString();
    // First bind pins the wall-clock deadline start; reattach never resets it.
    const deadlineStartedAt = job.workerDeadlineStartedAt ?? nowIso;
    patchJob(input.store, job.id, {
      workerAgentId: handle.agentId,
      workerResumeAgentId: handle.agentId,
      workerCheckpointAt: nowIso,
      workerDeadlineStartedAt: deadlineStartedAt,
      notes: [
        job.notes,
        reattached
          ? `worker-reattach: ${handle.agentId} (${profileName})`
          : `worker: ${handle.agentId} (${profileName})`,
      ]
        .filter(Boolean)
        .join('\n'),
    });

    // Fire-and-forget: interactive lane must not await worker completion.
    void handle.completion
      .then(async (completion) => {
        disposeProgressStall();
        const current = getJob(input.store, job.id);
        // If cancelled/interrupted while running, keep that terminal state.
        if (current?.status === 'cancelled' || current?.status === 'interrupted') {
          return;
        }
        // Commit backstop: a dirty worktree here means the worker skipped the
        // contract — snapshot so land/merge and GC cannot lose the work.
        const commitNote = await snapshotWorkerWorktree(input.agent, current ?? job);
        const ledgerJob = current ?? job;
        const contract =
          completion.contract !== undefined
            ? applySurfaceKindToContract(completion.contract, ledgerJob.surfaceKind, {
                ledgerVisual: undefined,
              })
            : undefined;
        const rawSummary =
          typeof completion.result === 'string'
            ? completion.result
            : String(completion.result ?? '');
        const contractSummary = contract?.summary.trim() ?? '';
        // Prefer the contract summary for storage: the free-form result may
        // embed the JSON envelope, which eats the stored-summary budget.
        const summary =
          (contractSummary || rawSummary.trim()).slice(0, 4000) || 'worker completed';
        const verificationFailed = contract?.verification_failed === true;
        // The gate skips more often than it runs (explore jobs, multi-package
        // changes, paths outside the workspace layout, gate timeouts). Such a
        // job is still `done`, but saying so plainly keeps the conductor from
        // reading "no failure" as "verified" when it decides to merge.
        const unverified =
          !verificationFailed &&
          verificationIsUnverified(contract?.verification, {
            requireVisual: surfaceRequiresVisualProof(ledgerJob.surfaceKind),
          });
        // Goal-driver terminal mapping (spec 2026-08-04-goal-driver-jobs §3.5):
        // a stopped goal (blocked/paused — budget circuit breaker, stagnation,
        // or a worker-reported blocker) escalates as a resumable `blocked` Job;
        // the verification gate still outranks it (invariant 4).
        const goalStopped =
          completion.goalStatus === 'blocked' || completion.goalStatus === 'paused';
        const finalStatus: JobStatus = verificationFailed
          ? 'failed'
          : goalStopped
            ? 'blocked'
            : 'done';
        // Parse BEFORE the 4k storage slice — dual-axis JSON is usually at the
        // end of a long report and gets cut mid-`findings` otherwise.
        const verifyVerdictField =
          ledgerJob.kind === 'verify'
            ? (() => {
                const parsed =
                  parseVerifyVerdict(rawSummary.trim()) ??
                  parseVerifyVerdict(contractSummary) ??
                  parseVerifyVerdict(summary);
                if (parsed === 'passed' || parsed === 'failed') return parsed;
                return undefined;
              })()
            : undefined;
        // Done without dual-axis JSON is a format failure — fail so Conductor does not MergeJob.
        const verifyMissingStructured =
          ledgerJob.kind === 'verify' &&
          finalStatus === 'done' &&
          verifyVerdictField === undefined;
        const effectiveStatus: JobStatus = verifyMissingStructured ? 'failed' : finalStatus;
        const goalReason = completion.goalTerminalReason
          ? ` (${completion.goalTerminalReason})`
          : '';
        // Keep a compact, parseable verdict line ahead of the truncated prose
        // so resume heal / JobInspect still see dual-axis JSON after the 4k cut.
        const verifyStampLine =
          verifyVerdictField === 'passed' || verifyVerdictField === 'failed'
            ? `{"verdict":"${verifyVerdictField === 'passed' ? 'pass' : 'fail'}","standards":{"verdict":"${verifyVerdictField === 'passed' ? 'pass' : 'fail'}","findings":[]},"spec":{"verdict":"${verifyVerdictField === 'passed' ? 'pass' : 'fail'}","findings":[]}}\n\n`
            : '';
        const baseSummary = verificationFailed
          ? `verification failed — ${summary}`
          : verifyMissingStructured
            ? `structured verifyVerdict missing — ${summary}`
            : goalStopped
              ? `goal ${completion.goalStatus}${goalReason} — ${summary}`
              : unverified
                ? `${UNVERIFIED_SUMMARY_PREFIX}${summary}`
                : `${verifyStampLine}${summary}`;
        // Feed worker struggle stats into Conductor inbox so auto-refine sees them.
        const frictionBlock =
          completion.friction !== undefined
            ? renderFrictionSection(completion.friction)
            : undefined;
        const resultSummary =
          frictionBlock !== undefined
            ? `${baseSummary}\n\n${frictionBlock}`.slice(0, 4500)
            : baseSummary;
        const updated = patchJob(input.store, job.id, {
          // A done with a failed verification gate misled the conductor:
          // surface explicit verification failures as failed so the playbook
          // routes them to inspection instead of merge/land.
          status: effectiveStatus,
          resultSummary,
          ...(contract !== undefined ? { resultContract: contract } : {}),
          ...(completion.goalId !== undefined ? { goalId: completion.goalId } : {}),
          ...(verifyVerdictField !== undefined ? { verifyVerdict: verifyVerdictField } : {}),
          notes: [
            getJob(input.store, job.id)?.notes,
            commitNote,
            verificationFailed
              ? 'worker: completed but verification failed'
              : verifyMissingStructured
                ? 'worker: verify finished without structured verifyVerdict'
                : goalStopped
                  ? `worker: goal ${completion.goalStatus}${goalReason}`
                  : unverified
                    ? 'worker: completed unverified (checks did not run)'
                    : 'worker: completed',
          ]
            .filter(Boolean)
            .join('\n'),
        });
        if (updated) {
          notifyJobTerminal({
            store: input.store,
            job: updated,
            status: effectiveStatus,
            summary: updated.resultSummary,
            agent: input.agent,
          });
          syncGoalDeskParentFromDriver(input.store, updated, input.agent);
          feedParentHarnessFromJobCompletion(input.agent, completion);
          try {
            await onJobTerminalForVerifyChain(input.store, updated, input.agent);
          } catch (error) {
            input.agent.log.warn('verify chain enqueue failed', error);
          }
        }
      })
      .catch(async (error: unknown) => {
        disposeProgressStall();
        const current = getJob(input.store, job.id);
        if (current?.status === 'cancelled' || current?.status === 'interrupted') {
          return;
        }
        // A crashed worker can leave partial work in the tree — snapshot it
        // so the failure path does not silently discard recoverable changes.
        const commitNote = await snapshotWorkerWorktree(input.agent, current ?? job);
        const detail = error instanceof Error ? error.message : String(error);
        // Wall-clock abort: always persist a resume handoff (last phase/files/
        // command) so continue_from does not restart a repo-wide scan empty.
        const isDeadline = isSubagentDeadlineError(error);
        const ledgerJob = current ?? job;
        const resultSummary = isDeadline
          ? buildDeadlineFailureSummary(
              ledgerJob,
              detail,
              ledgerJob.workerAgentId ?? handle.agentId,
            )
          : detail.slice(0, 2000);
        const updated = patchJob(input.store, job.id, {
          status: 'failed',
          resultSummary,
          notes: [
            getJob(input.store, job.id)?.notes,
            commitNote,
            isDeadline
              ? `worker_deadline: ${detail}`
              : `worker_failed: ${detail}`,
          ]
            .filter(Boolean)
            .join('\n'),
        });
        if (updated) {
          notifyJobTerminal({
            store: input.store,
            job: updated,
            status: 'failed',
            summary: updated.resultSummary,
            agent: input.agent,
          });
          syncGoalDeskParentFromDriver(input.store, updated, input.agent);
        }
      })
      .finally(() => {
        unbindJobWorkerLedger(handle.agentId);
        clearJobWorkerHandle(job.id);
        pumpSchedulerAfterWorker(input.agent, input.store);
      });

    // Goal Desk: spawn success must clear a stuck blocked binding even when
    // the operator resumed via JobResume (not /goal resume).
    if (job.kind === 'goal-driver') {
      const live = getJob(input.store, job.id);
      if (live !== undefined) {
        syncGoalDeskParentFromDriver(input.store, live, input.agent);
      }
    }

    return { ok: true, workerAgentId: handle.agentId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    clearJobWorkerHandle(job.id);
    const current = getJob(input.store, job.id);
    // A budget-exceeded hold (`blocked`, recorded by the offload lane) and
    // user-driven terminal states (cancel/interrupt) must not be clobbered
    // by a late spawn failure; only a live `running` job flips to failed.
    const keepState =
      current !== undefined &&
      (current.status === 'blocked' || isTerminalOrCancelled(current.status));

    // Ownership race residual: re-queue instead of failing so the scheduler
    // can start the job after the holder releases (Job path only).
    if (!keepState && current !== undefined && isOwnershipConflictError(detail)) {
      const holderId = holderJobIdFromOwnershipError(detail) ?? 'unknown';
      const pathMatch = /Ownership conflict on ([^:]+):/.exec(detail);
      const path = pathMatch?.[1]?.trim() || 'unknown';
      const deferred = ownershipDeferredNote(holderId, path);
      const prior = (current.notes ?? job.notes ?? '')
        .split('\n')
        .filter(
          (row) =>
            !row.startsWith('ownership_deferred:') &&
            !row.startsWith('spawn_failed:'),
        )
        .join('\n');
      patchJob(input.store, job.id, {
        status: 'queued',
        resultSummary: undefined,
        notes: [prior, deferred].filter(Boolean).join('\n'),
      });
      void requestJobSchedulePump({ store: input.store, agent: input.agent });
      return { ok: false, error: detail };
    }

    const updated = patchJob(input.store, job.id, {
      ...(keepState ? {} : { status: 'failed' as const, resultSummary: detail.slice(0, 2000) }),
      notes: [current?.notes ?? job.notes, `spawn_failed: ${detail}`].filter(Boolean).join('\n'),
    });
    if (updated && !keepState) {
      notifyJobTerminal({
        store: input.store,
        job: updated,
        status: 'failed',
        summary: detail,
        agent: input.agent,
      });
    }
    return { ok: false, error: detail };
  }
}

/**
 * Cancel a job worker: abort live handle, mark ledger cancelled, inbox notify, reschedule.
 */
export async function cancelJobWorker(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly jobId: string;
  readonly reason?: string;
}): Promise<{
  readonly ok: boolean;
  readonly job?: JobRecord;
  readonly aborted: boolean;
  readonly error?: string;
}> {
  const existing = getJob(input.store, input.jobId);
  if (existing === undefined) {
    return { ok: false, aborted: false, error: `Job not found: ${input.jobId}` };
  }
  if (existing.status === 'done' || existing.status === 'cancelled') {
    return { ok: true, job: existing, aborted: false };
  }

  const aborted = abortRegisteredJobWorker(input.jobId, userCancellationReason());
  clearJobWorkerHandle(input.jobId);

  const job = patchJobAndNotify(
    input.store,
    input.jobId,
    {
      status: 'cancelled',
      notes: [
        existing.notes,
        input.reason ? `cancel: ${input.reason}` : 'cancel',
        aborted ? 'worker: aborted' : 'worker: no live handle',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary: input.reason },
  );

  if (input.agent) {
    pumpSchedulerAfterWorker(input.agent, input.store);
  }

  return { ok: true, job, aborted };
}

/**
 * Steer a running job worker via subagentHost when possible; always records note on ledger.
 */
export function steerJobWorker(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly jobId: string;
  readonly message: string;
  readonly status?: JobStatus;
  readonly surfaceKind?: JobRecord['surfaceKind'];
}): {
  readonly ok: boolean;
  readonly job?: JobRecord;
  readonly steered: boolean;
  readonly error?: string;
} {
  const existing = getJob(input.store, input.jobId);
  if (existing === undefined) {
    return { ok: false, steered: false, error: `Job not found: ${input.jobId}` };
  }

  let steered = false;
  const workerId = existing.workerAgentId ?? getJobWorkerHandle(input.jobId)?.workerAgentId;
  const host = input.agent?.subagentHost as
    | { steerChild?: (id: string, parts: readonly { type: string; text: string }[]) => boolean }
    | undefined;
  if (workerId && host && typeof host.steerChild === 'function') {
    try {
      steered = host.steerChild(workerId, [{ type: 'text', text: input.message }]);
    } catch {
      steered = false;
    }
  }
  // Ledger patches (esp. surface_kind on blocked/done jobs with no worker) count as
  // steered so JobSteer is not a no-op when the worker is inactive.
  if (!steered && input.surfaceKind !== undefined) {
    steered = true;
  }

  const note = [
    existing.notes,
    `steer: ${input.message}`,
    input.surfaceKind !== undefined ? `steer: surface_kind=${input.surfaceKind}` : undefined,
    steered
      ? workerId && host
        ? 'steer: delivered to worker'
        : 'steer: ledger patched (worker not active)'
      : 'steer: ledger only (worker not active)',
  ]
    .filter(Boolean)
    .join('\n');
  const job = patchJobAndNotify(
    input.store,
    input.jobId,
    {
      notes: note,
      status: input.status ?? existing.status,
      prompt: existing.prompt ? `${existing.prompt}\n\n[steer] ${input.message}` : input.message,
      ...(input.surfaceKind !== undefined ? { surfaceKind: input.surfaceKind } : {}),
    },
    { agent: input.agent, summary: input.message },
  );
  return { ok: true, job, steered };
}

/**
 * Completion/cancel hook: request a scheduler pump on the offload lane.
 * V2-1: the pump is fire-and-forget and serialized; failures are recorded by
 * the offload lane, never on the completion/cancel path.
 */
export function pumpSchedulerAfterWorker(agent: Agent, store: ToolStore): void {
  void requestJobSchedulePump({ store, agent });
}

/**
 * Resume interrupted (or blocked-by-interrupt) jobs: re-queue then schedule.
 * One-click path for `/job resume` and JobResume tool.
 * When `answer` is provided, the job is treated as a needs_user interview
 * card: the answer is injected into notes and the job re-queued so the
 * worker resumes with the user's input (mid-tool-loop input queue path).
 *
 * Live shared-RPC interviews keep ledger status `running` while the question
 * UI is open. Late answers still deliver: abort the stalled waiter, append
 * the answer, and re-queue (same as a paused needs_user card).
 */
export async function resumeJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  /** Specific job id; omit to resume all interrupted. */
  readonly jobId?: string;
  /** Optional user answer for a needs_user card. */
  readonly answer?: string;
}): Promise<{
  readonly ok: boolean;
  readonly resumed: readonly JobRecord[];
  readonly message: string;
  readonly error?: string;
}> {
  const { store, agent, jobId, answer } = input;
  const candidates = listJobs(store).filter((j) => {
    if (jobId !== undefined) return j.id === jobId;
    if (answer !== undefined) return j.status === 'needs_user' || isLiveInterviewJob(j);
    return j.status === 'interrupted';
  });

  if (jobId !== undefined && candidates.length === 0) {
    return { ok: false, resumed: [], message: '', error: `Job not found: ${jobId}` };
  }

  const resumed: JobRecord[] = [];
  for (const job of candidates) {
    const liveInterviewAnswer =
      answer !== undefined && job.status === 'running' && isLiveInterviewJob(job);
    if (
      job.status !== 'interrupted' &&
      job.status !== 'blocked' &&
      job.status !== 'failed' &&
      job.status !== 'cancelled' &&
      job.status !== 'needs_user' &&
      !liveInterviewAnswer
    ) {
      if (jobId !== undefined) {
        return {
          ok: false,
          resumed: [],
          message: '',
          error: `Job ${job.id} is ${job.status}; resume targets interrupted/blocked/failed/cancelled/needs_user (or running interview with answer).`,
        };
      }
      continue;
    }
    // Do not resume cancelled unless explicitly requested by id.
    if (job.status === 'cancelled' && jobId === undefined) continue;
    if (job.status === 'failed' && jobId === undefined) continue;

    const isAnswerCard =
      answer !== undefined && (job.status === 'needs_user' || liveInterviewAnswer);
    if (liveInterviewAnswer) {
      // Release the hung requestQuestion waiter / worker so re-queue is clean.
      abortRegisteredJobWorker(job.id, new Error('user-answer: late interview answer'));
      clearJobWorkerHandle(job.id);
    }
    const notes = isAnswerCard
      ? [job.notes, `user-answer: ${answer}`].filter(Boolean).join('\n')
      : [job.notes, 'resume: re-queued'].filter(Boolean).join('\n');
    const next = patchJob(store, job.id, {
      status: 'queued',
      notes,
      // Notes never reach a relaunched worker (jobPrompt reads the brief
      // only), so the answer must ride on the prompt to survive relaunch.
      ...(isAnswerCard
        ? { prompt: [job.prompt, `[user-answer] ${answer}`].filter(Boolean).join('\n\n') }
        : {}),
      // Keep worktreePath when present so schedule can reuse isolation.
    });
    if (next) {
      resumed.push(next);
      // Clear Goal Monitor blocked state as soon as the driver is re-queued;
      // do not wait for /goal resume or the first progress heartbeat.
      if (next.kind === 'goal-driver') {
        syncGoalDeskParentFromDriver(store, next, agent);
      }
    }
  }

  if (resumed.length === 0) {
    return {
      ok: true,
      resumed: [],
      message: jobId
        ? `Nothing to resume for ${jobId}.`
        : 'No interrupted jobs to resume.',
    };
  }

  let scheduleMessage = 'Queued for schedule.';
  if (agent) {
    // Await the schedule pump only (queued→running + spawn enqueue). Do not
    // await spawner.settle() — merge/push handshakes share that pool and can
    // hold the Conductor JobResume tool past the hard budget. Worker attach
    // lands on ledger/inbox asynchronously (same contract as JobCreate).
    await requestJobSchedulePump({ store, agent });
    scheduleMessage = 'Scheduling offloaded — transitions land on ledger/inbox.';
  }

  return {
    ok: true,
    resumed,
    message: `Resumed ${resumed.length} job(s). ${scheduleMessage}`,
  };
}

/**
 * Shared-RPC AskUserQuestion keeps the job `running` and stamps interview notes
 * / resultSummary. Used so JobResume(answer) can deliver a late answer without
 * rejecting `running`.
 */
function isLiveInterviewJob(job: JobRecord): boolean {
  if (job.status !== 'running') return false;
  const summary = job.resultSummary ?? '';
  if (summary.startsWith('needs_user:')) return true;
  const notes = job.notes ?? '';
  return notes.includes('interview:');
}

/**
 * Interrupt all running jobs (session pause): abort workers + ledger interrupted + inbox.
 */
export function interruptRunningJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly reason?: string;
}): readonly JobRecord[] {
  const reason = input.reason ?? 'session interrupted';
  const out: JobRecord[] = [];
  for (const job of listJobs(input.store)) {
    if (job.status !== 'running') continue;
    abortRegisteredJobWorker(job.id, new Error(reason));
    clearJobWorkerHandle(job.id);
    const next = patchJobAndNotify(
      input.store,
      job.id,
      {
        status: 'interrupted',
        notes: [job.notes, `interrupt: ${reason}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: reason },
    );
    if (next) out.push(next);
  }
  return out;
}

/**
 * After hard process death, the ledger can still say `running` with no live
 * worker. Same transition as {@link interruptRunningJobs}; abort is a no-op
 * when nothing is registered. Call on Agent.resume so `/job resume` can restore.
 */
export function reconcileStaleRunningJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly reason?: string;
}): readonly JobRecord[] {
  return interruptRunningJobs({
    store: input.store,
    agent: input.agent,
    reason: input.reason ?? 'process restarted',
  });
}

export { abortRegisteredJobWorker as abortJobWorker };

/**
 * Wire Job worker evidence into the Conductor harness loop: gate scores
 * (measured refine rollback), auto-refine nudge, and worker tool events for
 * auto-skillify. Child agents have no refine/skillify services.
 */
function feedParentHarnessFromJobCompletion(
  parent: Agent,
  completion: SubagentCompletion,
): void {
  const refine = parent.refine;
  if (refine !== null && refine !== undefined) {
    if (completion.gateOutcome !== undefined) {
      void refine.recordGateOutcome(completion.gateOutcome).catch((error: unknown) => {
        parent.log.warn('parent refine gate-outcome scoring failed', error);
      });
    }
    const hasFriction = (completion.friction?.toolErrors ?? 0) > 0;
    if (hasFriction || completion.gateOutcome !== undefined) {
      refine.maybeAutoRefine('job');
    }
  }
  if (
    completion.skillifyEvents !== undefined &&
    completion.skillifyEvents.length > 0 &&
    parent.skillify !== null &&
    parent.skillify !== undefined
  ) {
    parent.skillify.ingestWorkerEvents(completion.skillifyEvents);
  }
}
