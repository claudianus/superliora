/**
 * Conductor Job desk slash commands — `/jobs`, `/job`.
 * When `conductor_ux_v2` is on: Session Job RPC hotpath (no LLM injection).
 * When off: natural-language tool prompts via sendNormalUserInput.
 */

import { applyConductorProjectMode } from '../features/control-tower/conductor-ux';
import { openInbox } from '../features/control-tower/inbox-controller';
import { jobCreateBatchWithSplitConfirm } from '../utils/job/job-create-batch';
import {
  CONDUCTOR_PROJECT_MODES,
  type ConductorProjectMode,
} from '../utils/job/intent-brief';
import {
  hotpathJobCancel,
  hotpathJobGc,
  hotpathJobInspect,
  hotpathJobList,
  hotpathJobResume,
  isConductorUxV2Enabled,
} from './job-hotpath';
import type { SlashCommandHost } from './hub/dispatch';
import { ttui } from '../utils/tui-i18n';

function isConductorProjectMode(value: string): value is ConductorProjectMode {
  return (CONDUCTOR_PROJECT_MODES as readonly string[]).includes(value);
}

function isBoardArgs(args: string): boolean {
  return args === 'board' || args === 'view' || args === 'open';
}

function isDeckArgs(args: string): boolean {
  return args === 'deck' || args === 'monitor' || args === 'watch';
}

export function handleJobsCommand(host: SlashCommandHost, rawArgs: string): void {
  const args = rawArgs.trim();
  if (isBoardArgs(args)) {
    // The in-stack Job Desk board was absorbed into Mission Control; the
    // deck viewer is the board now.
    host.jobBoardController.openDeck();
    return;
  }
  if (isDeckArgs(args)) {
    host.jobBoardController.openDeck();
    return;
  }
  if (args.startsWith('deck ') || args.startsWith('monitor ') || args.startsWith('watch ')) {
    // /jobs deck <id> — drill into one card directly.
    host.jobBoardController.openDeck(args.replace(/^\S+\s+/u, '').trim() || undefined);
    return;
  }
  if (args.length === 0) {
    if (isConductorUxV2Enabled()) {
      void hotpathJobList(host);
      return;
    }
    host.sendNormalUserInput(
      'Use JobList to show the Conductor job ledger as a compact table (id, status, kind, priority, title, worktree). Include JobInbox unread summary via JobInbox if any. Do not start new work.',
      { displayText: '/jobs' },
    );
    return;
  }
  // /jobs <id> → inspect
  if (args.startsWith('job_') || !args.includes(' ')) {
    handleJobCommand(host, args);
    return;
  }
  handleJobCommand(host, args);
}

export function handleJobCommand(host: SlashCommandHost, rawArgs: string): void {
  const args = rawArgs.trim();
  const tokens = args.length === 0 ? [] : args.split(/\s+/u);
  const sub = (tokens[0] ?? '').toLowerCase();
  const uxV2 = isConductorUxV2Enabled();

  switch (sub) {
    case '':
    case 'help':
    case '?':
      host.showStatus(ttui('tui.jobs.usage'));
      return;

    case 'board':
    case 'view':
    case 'open':
      host.jobBoardController.openDeck();
      return;

    case 'deck':
    case 'monitor':
    case 'watch': {
      const jobId = tokens.slice(1).join(' ').trim();
      host.jobBoardController.openDeck(jobId.length > 0 ? jobId : undefined);
      return;
    }

    case 'list':
    case 'ls':
      if (uxV2) {
        void hotpathJobList(host);
        return;
      }
      host.sendNormalUserInput(
        'Use JobList to show the Conductor job ledger as a compact table (id, status, kind, priority, title). Include a one-line Job strip summary.',
        { displayText: '/job list' },
      );
      return;

    case 'inbox':
      if (uxV2) {
        openInbox(host);
        return;
      }
      host.sendNormalUserInput(
        'Use JobInbox to show unread Conductor job notices (completions, failures, needs_user). Mark them read after summarizing.',
        { displayText: '/job inbox' },
      );
      return;

    case 'resume': {
      const jobId = tokens.slice(1).join(' ').trim();
      if (uxV2) {
        void hotpathJobResume(host, jobId.length === 0 ? {} : { jobId });
        return;
      }
      if (jobId.length === 0) {
        host.sendNormalUserInput(
          'Use JobResume with no job_id to re-queue all interrupted Conductor jobs, then report what resumed.',
          { displayText: '/job resume' },
        );
        return;
      }
      host.sendNormalUserInput(
        `Use JobResume with job_id=${jobId} to re-queue and schedule that job. Report ACK state.`,
        { displayText: `/job resume ${jobId}` },
      );
      return;
    }

    case 'answer':
    case 'reply': {
      // /job answer <job_id> <text…> — answer a needs_user interview card.
      const jobId = tokens[1] ?? '';
      const answer = tokens.slice(2).join(' ').trim();
      if (jobId.length === 0 || answer.length === 0) {
        host.showStatus(
          ttui('tui.jobs.answerUsage'),
        );
        return;
      }
      if (uxV2) {
        void hotpathJobResume(host, { jobId, answer });
        return;
      }
      host.sendNormalUserInput(
        `Use JobResume with job_id=${jobId} and answer=${JSON.stringify(answer)} to inject the user answer into the needs_user card and re-queue the job. Report the resumed state.`,
        { displayText: `/job answer ${jobId} ${answer}` },
      );
      return;
    }

    case 'cancel':
    case 'stop': {
      const jobId = tokens.slice(1).join(' ').trim();
      if (jobId.length === 0) {
        host.showStatus(ttui('tui.jobs.cancelUsage'));
        return;
      }
      if (uxV2) {
        void hotpathJobCancel(host, jobId);
        return;
      }
      host.sendNormalUserInput(
        `Use JobCancel with job_id=${jobId} to cancel the job and abort its worker if live. Report final state.`,
        { displayText: `/job cancel ${jobId}` },
      );
      return;
    }

    case 'inspect':
    case 'show':
    case 'get': {
      const jobId = tokens.slice(1).join(' ').trim();
      if (jobId.length === 0) {
        host.showStatus(ttui('tui.jobs.inspectUsage'));
        return;
      }
      if (uxV2) {
        void hotpathJobInspect(host, jobId);
        return;
      }
      host.sendNormalUserInput(
        `Use JobInspect with job_id=${jobId} and summarize status, paths, worktree, and result.`,
        { displayText: `/job inspect ${jobId}` },
      );
      return;
    }

    case 'gc':
      if (uxV2) {
        void hotpathJobGc(host);
        return;
      }
      host.sendNormalUserInput(
        'Run JobList, then for done jobs with worktrees note GC policy (success remove; failed TTL 7d). If a JobSchedule/GC helper is available, pump GC; otherwise report which worktrees are eligible and use session worktree tools only if safe.',
        { displayText: '/job gc' },
      );
      return;

    case 'mode': {
      if (!uxV2) {
        host.showStatus(ttui('tui.jobs.modeNeedsUx'), 'textMuted');
        return;
      }
      const modeArg = (tokens[1] ?? '').toLowerCase();
      if (!isConductorProjectMode(modeArg)) {
        host.showStatus(
          ttui('tui.jobs.modeUsage'),
          'textMuted',
        );
        return;
      }
      applyConductorProjectMode(
        {
          state: host.state,
          session: host.session,
          setAppState: (patch) => host.setAppState(patch),
          showStatus: (msg, color) => host.showStatus(msg, color),
        },
        modeArg,
      );
      return;
    }

    case 'split-preview':
    case 'split': {
      const text = tokens.slice(1).join(' ').trim();
      if (!uxV2) {
        host.showStatus(ttui('tui.jobs.splitNeedsUx'), 'textMuted');
        return;
      }
      if (text.length === 0) {
        host.showStatus(
          ttui('tui.jobs.splitUsage'),
        );
        return;
      }
      void jobCreateBatchWithSplitConfirm(
        {
          mountEditorReplacement: (panel) => host.mountEditorReplacement(panel),
          restoreEditor: () => host.restoreEditor(),
          requestRender: () => host.state.renderer.requestRender('manual'),
          showStatus: (msg, color) => host.showStatus(msg, color),
          requireSession: () => host.requireSession(),
        },
        text,
      );
      return;
    }

    case 'schedule':
    case 'pump':
      // No dedicated RPC schedule surface yet — keep agent routing.
      host.sendNormalUserInput(
        'Use JobSchedule (or JobCreate pump via listing queued + schedule) to promote queued Conductor jobs under maxConcurrent. Report started/blocked/backpressure.',
        { displayText: '/job schedule' },
      );
      return;

    default: {
      // Bare job id: /job job_xxx
      if (sub.startsWith('job_') || tokens.length === 1) {
        const jobId = tokens[0] ?? sub;
        if (uxV2) {
          void hotpathJobInspect(host, jobId);
          return;
        }
        host.sendNormalUserInput(
          `Use JobInspect with job_id=${jobId} and summarize the Conductor job.`,
          { displayText: `/job ${jobId}` },
        );
        return;
      }
      host.showStatus(ttui('tui.jobs.usage'));
      return;
    }
  }
}
