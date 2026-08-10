/**
 * F13 — surface Conductor job recovery after session resume/startup.
 * Autopilot may already have re-queued safe jobs; this banner reports
 * resumed vs held (merge/push/needs_you) instead of only "press /job resume".
 */

import type { Session } from '@superliora/sdk';
import { JOB_EVENT_SCHEMA_VERSION, type JobSnapshot } from '@superliora/protocol';

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import {
  applyAutoResumeFleetEnv,
  DEFAULT_CONDUCTOR_PREFERENCES,
  type ConductorPreferences,
} from '../../config';
import type { ColorToken } from '../../theme';
import type { ControlTowerJobDesk } from './job-desk-events';
import type { MissionControlController } from '../../controllers/mission-control/controller';

export interface InterruptedBannerHost {
  showStatus(msg: string, color?: ColorToken): void;
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  readonly controlTowerDesk?: ControlTowerJobDesk;
  readonly missionControl?: MissionControlController;
  readonly state?: {
    readonly appState: {
      readonly conductor?: ConductorPreferences;
    };
  };
}

const HOLD_KINDS = new Set(['merge', 'push']);

function classifyRecovery(jobs: readonly JobSnapshot[]): {
  readonly resuming: number;
  readonly held: number;
  readonly interrupted: number;
} {
  let resuming = 0;
  let held = 0;
  let interrupted = 0;
  for (const job of jobs) {
    if (job.status === 'queued' || job.status === 'running') {
      // Autopilot just re-queued / spawn in flight.
      resuming += 1;
      continue;
    }
    if (job.status === 'interrupted') {
      interrupted += 1;
      if (HOLD_KINDS.has(job.kind) || job.status === 'interrupted') {
        // Remaining interrupted after autopilot = held or pref-off.
        held += 1;
      }
      continue;
    }
    if (job.status === 'needs_user' || job.status === 'blocked') {
      held += 1;
    }
  }
  return { resuming, held, interrupted };
}

/** Query JobList, seed the desk store, hydrate dock ghosts, announce recovery. */
export async function maybeAnnounceInterruptedJobs(
  host: InterruptedBannerHost,
  session: Session,
): Promise<void> {
  if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
  if (typeof session.jobList !== 'function') return;
  const prefs = host.state?.appState.conductor ?? DEFAULT_CONDUCTOR_PREFERENCES;
  applyAutoResumeFleetEnv(prefs);
  try {
    const jobs = await session.jobList();
    const desk = host.controlTowerDesk;
    if (desk !== undefined) {
      for (const job of jobs) {
        desk.store.applyJobUpdated({
          type: 'job.updated',
          schemaVersion: JOB_EVENT_SCHEMA_VERSION,
          job,
        });
      }
      desk.publishFromStore();
      host.missionControl?.hydrateGhostsFromJobs(desk.store.snapshot());
      announceRecovery(host, jobs, prefs.autoResumeFleet);
      return;
    }
    announceRecovery(host, jobs, prefs.autoResumeFleet);
  } catch {
    // Best-effort: resume must not block on JobList.
  }
}

function announceRecovery(
  host: InterruptedBannerHost,
  jobs: readonly JobSnapshot[],
  autoResume: boolean,
): void {
  const { resuming, held, interrupted } = classifyRecovery(jobs);
  if (resuming <= 0 && held <= 0 && interrupted <= 0) return;

  if (autoResume && resuming > 0) {
    const heldBit =
      held > 0 ? ` · held ${String(held)} (merge/push/needs_you)` : '';
    const title = `Resuming ${String(resuming)} job${resuming === 1 ? '' : 's'}${heldBit}`;
    const detail =
      held > 0
        ? 'Safe jobs relaunched. Confirm held work via Inbox (Alt+I) or /job resume <id>.'
        : 'Fleet autopilot relaunched interrupted workers.';
    host.showNotice?.(title, detail, { coalesceKey: 'job-interrupted-banner' });
    host.showStatus(title, 'info');
    return;
  }

  const n = interrupted > 0 ? interrupted : held;
  if (n <= 0) return;
  host.showNotice?.(
    `${String(n)} interrupted job${n === 1 ? '' : 's'}`,
    autoResume
      ? 'Held for confirm — Inbox (Alt+I) or /job resume'
      : '/job resume or open Inbox (Alt+I) · auto-resume off',
    { coalesceKey: 'job-interrupted-banner' },
  );
  host.showStatus(
    autoResume
      ? `${String(n)} held jobs — Inbox (Alt+I) or /job resume`
      : `${String(n)} interrupted jobs — /job resume or open Inbox (Alt+I)`,
    'warning',
  );
}
