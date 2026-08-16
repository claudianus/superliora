/**
 * Conductor meta inbox — completion/failure notices for the interactive lane.
 * P0–P1.5: store-backed event list; TUI strip + capped system injection attach later.
 */

import type { ToolStore } from '../../store';
import { capPinnedDiagnosticText, JOB_INBOX_SUMMARY_MAX_CHARS } from './job-ledger';
import type { JobStatus } from './job-store-key';

export const JOB_INBOX_STORE_KEY = 'job_inbox' as const;

export type JobInboxEventKind =
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.blocked'
  | 'job.needs_user'
  | 'job.interrupted'
  | 'recovery.auto_resumed'
  | 'recovery.held'
  | 'recovery.reattach_failed';

export interface JobInboxEvent {
  readonly id: string;
  readonly kind: JobInboxEventKind;
  readonly jobId: string;
  readonly status: JobStatus;
  readonly title: string;
  readonly summary?: string;
  readonly createdAt: string;
  readonly read: boolean;
  /** True when this event is a desk-digest escalation card (contract §4.2). */
  readonly digest?: boolean;
}

export interface JobInbox {
  readonly schemaVersion: 1;
  readonly events: readonly JobInboxEvent[];
}

declare module '../../store' {
  interface ToolStoreData {
    job_inbox: JobInbox;
  }
}

export function emptyJobInbox(): JobInbox {
  return { schemaVersion: 1, events: [] };
}

export function readJobInbox(store: ToolStore): JobInbox {
  return store.get(JOB_INBOX_STORE_KEY) ?? emptyJobInbox();
}

function writeJobInbox(store: ToolStore, inbox: JobInbox): void {
  store.set(JOB_INBOX_STORE_KEY, {
    schemaVersion: 1,
    events: inbox.events.map((e) => ({ ...e })),
  });
}

let inboxSeq = 0;

export function pushJobInboxEvent(
  store: ToolStore,
  input: {
    readonly kind: JobInboxEventKind;
    readonly jobId: string;
    readonly status: JobStatus;
    readonly title: string;
    readonly summary?: string;
    readonly digest?: boolean;
  },
): JobInboxEvent {
  const event: JobInboxEvent = {
    id: `jinbox_${Date.now().toString(36)}_${(inboxSeq += 1).toString(36)}`,
    kind: input.kind,
    jobId: input.jobId,
    status: input.status,
    title: input.title,
    summary:
      input.summary === undefined
        ? undefined
        : capPinnedDiagnosticText(input.summary, { maxChars: JOB_INBOX_SUMMARY_MAX_CHARS }).text,
    createdAt: new Date().toISOString(),
    read: false,
    digest: input.digest,
  };
  const inbox = readJobInbox(store);
  // Cap retained events to keep store small.
  const events = [...inbox.events, event].slice(-100);
  writeJobInbox(store, { schemaVersion: 1, events });
  return event;
}

export function listUnreadJobInbox(store: ToolStore): readonly JobInboxEvent[] {
  return readJobInbox(store).events.filter((e) => !e.read);
}

export function markJobInboxRead(store: ToolStore, eventIds?: readonly string[]): number {
  const set = eventIds ? new Set(eventIds) : undefined;
  const inbox = readJobInbox(store);
  let count = 0;
  const events = inbox.events.map((e) => {
    if (e.read) return e;
    if (set === undefined || set.has(e.id)) {
      count += 1;
      return { ...e, read: true };
    }
    return e;
  });
  writeJobInbox(store, { schemaVersion: 1, events });
  return count;
}

export function renderJobInboxBrief(events: readonly JobInboxEvent[]): string {
  if (events.length === 0) return 'Job inbox empty.';
  return [
    'Job inbox:',
    ...events.map(
      (e) =>
        `- ${e.read ? '[read] ' : ''}${e.kind} ${e.jobId} [${e.status}] ${e.title}${e.summary ? ` — ${e.summary.slice(0, 120)}` : ''}`,
    ),
  ].join('\n');
}

export function inboxKindForStatus(status: JobStatus): JobInboxEventKind | undefined {
  switch (status) {
    case 'done':
      return 'job.completed';
    case 'failed':
      return 'job.failed';
    case 'cancelled':
      return 'job.cancelled';
    case 'blocked':
      return 'job.blocked';
    case 'needs_user':
      return 'job.needs_user';
    case 'interrupted':
      return 'job.interrupted';
    default:
      return undefined;
  }
}
