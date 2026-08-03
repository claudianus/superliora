/**
 * Conductor Job desk slash commands — `/jobs`, `/job`.
 * Routes to Job* tools via normal agent input (same pattern as /cron).
 */

import type { SlashCommandHost } from './hub/dispatch';

const JOBS_USAGE =
  'Usage: /jobs — list Conductor jobs; /jobs board — show/hide the Job Desk panel in the transcript; /job <id> — inspect; /job resume [id] — resume interrupted; /job answer <id> <text> — answer needs_user card; /job cancel <id>; /job inbox; /job gc — worktree GC hint; /job help';

function isBoardArgs(args: string): boolean {
  return args === 'board' || args === 'view' || args === 'open';
}

export function handleJobsCommand(host: SlashCommandHost, rawArgs: string): void {
  const args = rawArgs.trim();
  if (isBoardArgs(args)) {
    host.jobBoardController.toggle();
    return;
  }
  if (args.length === 0) {
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

  switch (sub) {
    case '':
    case 'help':
    case '?':
      host.showStatus(JOBS_USAGE);
      return;

    case 'board':
    case 'view':
    case 'open':
      host.jobBoardController.toggle();
      return;

    case 'list':
    case 'ls':
      host.sendNormalUserInput(
        'Use JobList to show the Conductor job ledger as a compact table (id, status, kind, priority, title). Include a one-line Job strip summary.',
        { displayText: '/job list' },
      );
      return;

    case 'inbox':
      host.sendNormalUserInput(
        'Use JobInbox to show unread Conductor job notices (completions, failures, needs_user). Mark them read after summarizing.',
        { displayText: '/job inbox' },
      );
      return;

    case 'resume': {
      const jobId = tokens.slice(1).join(' ').trim();
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
          'Provide a job id and your answer: /job answer <job_id> <your input> — re-queues the needs_user card so the worker resumes with your input.',
        );
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
        host.showStatus('Provide a job id: /job cancel <job_id>. Use /jobs to list.');
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
        host.showStatus('Provide a job id: /job inspect <job_id>.');
        return;
      }
      host.sendNormalUserInput(
        `Use JobInspect with job_id=${jobId} and summarize status, paths, worktree, and result.`,
        { displayText: `/job inspect ${jobId}` },
      );
      return;
    }

    case 'gc':
      host.sendNormalUserInput(
        'Run JobList, then for done jobs with worktrees note GC policy (success remove; failed TTL 7d). If a JobSchedule/GC helper is available, pump GC; otherwise report which worktrees are eligible and use session worktree tools only if safe.',
        { displayText: '/job gc' },
      );
      return;

    case 'schedule':
    case 'pump':
      host.sendNormalUserInput(
        'Use JobSchedule (or JobCreate pump via listing queued + schedule) to promote queued Conductor jobs under maxConcurrent. Report started/blocked/backpressure.',
        { displayText: '/job schedule' },
      );
      return;

    default: {
      // Bare job id: /job job_xxx
      if (sub.startsWith('job_') || tokens.length === 1) {
        const jobId = tokens[0] ?? sub;
        host.sendNormalUserInput(
          `Use JobInspect with job_id=${jobId} and summarize the Conductor job.`,
          { displayText: `/job ${jobId}` },
        );
        return;
      }
      host.showStatus(JOBS_USAGE);
      return;
    }
  }
}
