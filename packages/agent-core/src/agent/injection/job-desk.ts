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
  formatJobStripLine,
  summarizeJobStrip,
} from '#/tools/builtin/job/job-runtime';

import { DynamicInjector } from './injector';

const JOB_DESK_VARIANT = 'conductor_job_desk';
const MAX_EVENTS = 5;
const MAX_CHARS = 1_500;

export class JobDeskInjector extends DynamicInjector {
  protected override readonly injectionVariant = JOB_DESK_VARIANT;

  protected override getInjection(): string | undefined {
    if (this.agent.type !== 'main') return undefined;
    const store = this.agent.tools.getStore();
    const unread = listUnreadJobInbox(store);
    if (unread.length === 0) {
      // Still show strip when in-flight jobs exist (no inbox spam).
      const strip = summarizeJobStrip(store);
      if (strip.running === 0 && strip.queued === 0 && strip.interrupted === 0 && strip.needsUser === 0) {
        return undefined;
      }
      // Throttle strip-only: once per injectedAt cycle is enough via DynamicInjector.
      if (this.injectedAt !== null) return undefined;
      return renderJobDeskInjection([], strip);
    }

    const batch = unread.slice(0, MAX_EVENTS);
    const strip = summarizeJobStrip(store);
    const text = renderJobDeskInjection(batch, strip);
    // Mark delivered so we do not re-inject every step (toast/TUI still have store).
    markJobInboxRead(
      store,
      batch.map((e) => e.id),
    );
    return text;
  }
}

function renderJobDeskInjection(
  events: readonly JobInboxEvent[],
  strip: ReturnType<typeof summarizeJobStrip>,
): string {
  const lines = [
    '<conductor_job_desk>',
    formatJobStripLine(strip, events.length),
  ];
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
  lines.push('</conductor_job_desk>');
  let text = lines.join('\n');
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS - 28)}\n… [truncated]\n</conductor_job_desk>`;
  }
  return text;
}
