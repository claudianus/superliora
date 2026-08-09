/**
 * Conductor UX v2 Job RPC hotpath — Session.job* instead of LLM tool injection.
 */

import { formatErrorMessage } from '../utils/event-payload';
import { shortJobId } from '../components/job-board/job-board-helpers';
import { isExperimentalFlagEnabled } from './experimental-flags';
import type { SlashCommandHost } from './hub/dispatch';
import { ttui } from '../utils/tui-i18n';

export function isConductorUxV2Enabled(): boolean {
  return isExperimentalFlagEnabled('conductor_ux_v2');
}

function ackStatus(host: SlashCommandHost, display: string, text: string): void {
  const line = text.trim().length > 0 ? text.trim() : 'ok';
  host.showStatus(ttui('tui.job.hotpathOk', { display, line }), 'success');
}

function failStatus(host: SlashCommandHost, display: string, error: unknown): void {
  host.showError(ttui('tui.job.hotpathFailed', { display, message: formatErrorMessage(error) }));
}

export async function hotpathJobSteer(
  host: SlashCommandHost,
  jobId: string,
  message: string,
): Promise<void> {
  const display = `/job steer ${shortJobId(jobId)}`;
  try {
    const result = await host.requireSession().jobSteer({ jobId, message });
    if (!result.ok) {
      host.showError(result.error ?? (result.text.length > 0 ? result.text : `${display} failed`));
      return;
    }
    ackStatus(host, display, result.text);
  } catch (error) {
    failStatus(host, display, error);
  }
}

export async function hotpathJobCancel(
  host: SlashCommandHost,
  jobId: string,
  reason?: string,
): Promise<void> {
  const display = `/job cancel ${shortJobId(jobId)}`;
  try {
    const result = await host.requireSession().jobCancel({
      jobId,
      ...(reason === undefined || reason.length === 0 ? {} : { reason }),
    });
    if (!result.ok) {
      host.showError(result.error ?? (result.text.length > 0 ? result.text : `${display} failed`));
      return;
    }
    ackStatus(host, display, result.text);
  } catch (error) {
    failStatus(host, display, error);
  }
}

export async function hotpathJobResume(
  host: SlashCommandHost,
  input: { readonly jobId?: string; readonly answer?: string } = {},
): Promise<void> {
  const display =
    input.jobId === undefined
      ? '/job resume'
      : input.answer !== undefined
        ? `/job answer ${shortJobId(input.jobId)}`
        : `/job resume ${shortJobId(input.jobId)}`;
  try {
    const result = await host.requireSession().jobResume(input);
    if (!result.ok) {
      host.showError(result.error ?? (result.text.length > 0 ? result.text : `${display} failed`));
      return;
    }
    const count = result.resumed.length;
    const summary =
      result.text.trim().length > 0
        ? result.text.trim()
        : count === 0
          ? 'nothing to resume'
          : `resumed ${String(count)}`;
    ackStatus(host, display, summary);
  } catch (error) {
    failStatus(host, display, error);
  }
}

export async function hotpathJobList(host: SlashCommandHost): Promise<void> {
  try {
    const jobs = await host.requireSession().jobList();
    if (jobs.length === 0) {
      host.showStatus(ttui('tui.jobs.noJobs'), 'textMuted');
      return;
    }
    const lines = jobs.slice(0, 24).map((job) => {
      const id = shortJobId(job.id);
      return `${id}  ${job.status.padEnd(12)}  ${job.kind.padEnd(10)}  p${String(job.priority)}  ${job.title}`;
    });
    const more = jobs.length > lines.length ? `\n… +${String(jobs.length - lines.length)} more` : '';
    host.showNotice(ttui('tui.job.conductorList', { count: String(jobs.length) }), `${lines.join('\n')}${more}`, {
      coalesceKey: 'job-list',
    });
    host.showStatus(ttui('tui.job.conductorHint', { count: String(jobs.length) }), 'info');
  } catch (error) {
    failStatus(host, '/job list', error);
  }
}

export async function hotpathJobInspect(host: SlashCommandHost, jobId: string): Promise<void> {
  const display = `/job inspect ${shortJobId(jobId)}`;
  try {
    const result = await host.requireSession().jobInspect(jobId);
    if (result === undefined) {
      host.showError(ttui('tui.job.noMatch', { jobId }));
      return;
    }
    host.showNotice(result.job.title, result.text.slice(0, 1200), {
      coalesceKey: `job-inspect:${result.job.id}`,
    });
    host.showStatus(ttui('tui.job.statusInfo', { display, status: result.job.status }), 'info');
  } catch (error) {
    failStatus(host, display, error);
  }
}

export async function hotpathJobGc(host: SlashCommandHost): Promise<void> {
  try {
    const result = await host.requireSession().jobGcWorktrees({ dryRun: false });
    host.showStatus(
      `Job GC — removed ${String(result.removed)}, kept ${String(result.kept)}`,
      result.removed > 0 ? 'success' : 'textMuted',
    );
  } catch (error) {
    failStatus(host, '/job gc', error);
  }
}
