/**
 * Job Deck opener — mounts the interactive Conductor monitoring viewer
 * (deck list + worker transcript drill-down). Shared by `/jobs deck`, the
 * Command Hub row, and Job Desk card clicks (mouse router).
 */

import type { SlashCommandHost } from './hub/dispatch';
import {
  JobDeckViewerComponent,
  type JobDeckWorkerLoad,
} from '../components/dialogs/job-deck/job-deck-viewer';
import type { ConductorJobCard } from '../utils/job/job-strip';
import {
  emptyConductorJobsSnapshot,
  resolveConductorJobCard,
} from '../utils/job/job-strip';
import { formatErrorMessage } from '../utils/event-payload';
import { shortJobId } from '../components/job-board/job-board-helpers';

export function openJobDeckViewer(host: SlashCommandHost, jobId?: string): void {
  if (host.session === undefined) {
    host.showError('No active session — the Job Deck needs a live session.');
    return;
  }
  const snapshot = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
  if (snapshot.jobs.length === 0) {
    host.showStatus(
      'No Conductor jobs yet — the Job Desk panel and deck open once jobs exist.',
      'textMuted',
    );
    return;
  }

  const resolved =
    jobId === undefined ? undefined : resolveConductorJobCard(snapshot.jobs, jobId);
  if (jobId !== undefined && resolved === undefined) {
    host.showStatus(
      `No Conductor job matches ${jobId}. Use /jobs deck to browse, or pass a full/short job id.`,
      'warning',
    );
    return;
  }

  const panel = new JobDeckViewerComponent({
    getSnapshot: () => host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot(),
    initialJobId: resolved?.id,
    loadWorker: (card) => loadJobDeckWorker(host, card),
    onAction: (action, card, text) => routeJobDeckAction(host, action, card, text),
    onCancel: () => {
      host.restoreEditor();
    },
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
  });
  host.mountEditorReplacement(panel);
}

async function loadJobDeckWorker(
  host: SlashCommandHost,
  card: ConductorJobCard,
): Promise<JobDeckWorkerLoad> {
  const agentId = card.workerAgentId;
  if (agentId === undefined || agentId.length === 0) {
    return { lines: [], error: 'This job has no worker agent session yet.' };
  }
  const session = host.requireSession();
  try {
    const [trace, usage] = await host.harness.withInteractiveAgent(agentId, () =>
      Promise.all([session.getSessionTrace(), session.getUsage()]),
    );
    const total = usage.total;
    const usageLoad =
      total === undefined
        ? undefined
        : {
            input: total.inputOther + total.inputCacheCreation,
            output: total.output,
            cacheRead: total.inputCacheRead,
          };
    if (usageLoad !== undefined) {
      host.jobBoardController.rememberUsage(card.id, usageLoad);
    }
    return {
      lines: formatJobDeckTraceLines(trace.context.history),
      usage: usageLoad,
    };
  } catch (caught) {
    return { lines: [], error: formatErrorMessage(caught) };
  }
}

function routeJobDeckAction(
  host: SlashCommandHost,
  action: 'steer' | 'answer' | 'resume' | 'cancel',
  card: ConductorJobCard,
  text?: string,
): void {
  host.restoreEditor();
  const id = card.id;
  switch (action) {
    case 'steer':
      host.sendNormalUserInput(
        `Use JobSteer with job_id=${id} and message=${JSON.stringify(text ?? '')} to steer the running Conductor worker in real time. Report ACK state briefly.`,
        { displayText: `/job steer ${shortJobId(id)} ${text ?? ''}` },
      );
      return;
    case 'answer':
      host.sendNormalUserInput(
        `Use JobResume with job_id=${id} and answer=${JSON.stringify(text ?? '')} to inject the user answer into the needs_user card and re-queue the job. Report the resumed state.`,
        { displayText: `/job answer ${shortJobId(id)} ${text ?? ''}` },
      );
      return;
    case 'resume':
      host.sendNormalUserInput(
        `Use JobResume with job_id=${id} to re-queue and schedule that job. Report ACK state.`,
        { displayText: `/job resume ${shortJobId(id)}` },
      );
      return;
    case 'cancel':
      host.sendNormalUserInput(
        `Use JobCancel with job_id=${id} to cancel the job and abort its worker if live. Report final state.`,
        { displayText: `/job cancel ${shortJobId(id)}` },
      );
      return;
  }
}

/**
 * Structural worker transcript formatter: user/assistant text plus tool
 * call headers, so the drill-down shows what the worker is actually doing.
 */
export function formatJobDeckTraceLines(
  history: readonly {
    readonly role?: string;
    readonly content?: readonly unknown[];
  }[],
  options: { readonly maxLines?: number } = {},
): readonly string[] {
  const maxLines = options.maxLines ?? 400;
  const lines: string[] = [];
  for (const message of history) {
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'other';
    if (role === 'other') continue;
    const content = message.content ?? [];
    for (const item of content) {
      if (item === null || typeof item !== 'object') continue;
      const part = item as Record<string, unknown>;
      const type = typeof part['type'] === 'string' ? part['type'] : '';
      if (type === 'text') {
        const text = typeof part['text'] === 'string' ? part['text'].trim() : '';
        if (text.length === 0) continue;
        const prefix = role === 'assistant' ? '◆' : '◇';
        for (const paragraph of text.split(/\n+/)) {
          const trimmed = paragraph.trim();
          if (trimmed.length > 0) lines.push(`${prefix} ${trimmed}`);
        }
        continue;
      }
      if (type === 'toolCall' || type === 'tool_use') {
        const name = typeof part['name'] === 'string' ? part['name'] : 'tool';
        const detail = summarizeToolInput(part['input']);
        lines.push(detail.length > 0 ? `⚙ ${name} ${detail}` : `⚙ ${name}`);
        continue;
      }
      if (type === 'toolResult' || type === 'tool_result') {
        const status = part['isError'] === true ? '✗' : '✓';
        lines.push(`${status} result`);
      }
    }
  }
  if (lines.length <= maxLines) return lines;
  const omitted = lines.length - maxLines;
  return [`… ${String(omitted)} earlier lines omitted`, ...lines.slice(-maxLines)];
}

function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const preferred = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'objective'];
  for (const key of preferred) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 60 ? `${value.slice(0, 59)}…` : value;
    }
  }
  return '';
}
