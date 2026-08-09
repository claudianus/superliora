/**
 * Open the Worker Dock transcript surface for a mission-control worker.
 * Prefer Job Deck when a Conductor job card owns the same agent id.
 */

import type { SlashCommandHost } from './hub/dispatch';
import { openJobDeckViewer } from './jobs-deck';
import { formatJobDeckTraceLines } from './jobs-deck';
import { WorkerTranscriptViewerComponent } from '../components/dialogs/mission-control/worker-transcript-viewer';
import {
  emptyConductorJobsSnapshot,
  type ConductorJobCard,
} from '../utils/job/job-strip';
import { formatErrorMessage } from '../utils/event-payload';
import { ttui } from '../utils/tui-i18n';

/**
 * Open worker transcript / detail for `workerId` (mission registry id =
 * subagentId / agentId).
 */
export function openWorkerTranscript(host: SlashCommandHost, workerId: string): void {
  const jobs = host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
  const jobCard = jobs.jobs.find(
    (card: ConductorJobCard) => card.workerAgentId === workerId,
  );
  if (jobCard !== undefined) {
    // Reuse the existing Job Deck transcript drill-down when linked.
    openJobDeckViewer(host, jobCard.id);
    return;
  }

  const panel = host.state.missionControlPanel;
  const worker =
    panel.currentView.snapshot.workers.find((entry) => entry.id === workerId) ??
    host.missionControl.registry.snapshot().workers.find((entry) => entry.id === workerId);

  if (worker === undefined) {
    host.showStatus(ttui('tui.missionControl.workerNotFound'), 'warning');
    return;
  }

  const viewer = new WorkerTranscriptViewerComponent({
    workerId,
    getWorker: () => {
      const snap = host.missionControl.registry.snapshot();
      return snap.workers.find((entry) => entry.id === workerId);
    },
    loadTranscript: (id) => loadWorkerTranscript(host, id),
    onCancel: () => {
      host.restoreEditor();
    },
    requestRender: () => {
      host.state.renderer.requestRender('manual');
    },
  });
  host.mountEditorReplacement(viewer);
}

async function loadWorkerTranscript(
  host: SlashCommandHost,
  workerId: string,
): Promise<{ readonly lines: readonly string[]; readonly error?: string }> {
  if (host.session === undefined) {
    return {
      lines: buildFallbackLines(host, workerId),
      error: undefined,
    };
  }
  try {
    const session = host.requireSession();
    // Interactive agent session when the harness can switch to this agent.
    const trace = await host.harness.withInteractiveAgent(workerId, () =>
      session.getSessionTrace(),
    );
    const lines = formatJobDeckTraceLines(trace.context.history);
    if (lines.length > 0) return { lines };
    return { lines: buildFallbackLines(host, workerId) };
  } catch (caught) {
    const fallback = buildFallbackLines(host, workerId);
    if (fallback.length > 0) {
      return { lines: fallback };
    }
    return { lines: [], error: formatErrorMessage(caught) };
  }
}

/** Registry telemetry when a full session trace is unavailable. */
function buildFallbackLines(
  host: SlashCommandHost,
  workerId: string,
): string[] {
  const snap = host.missionControl.registry.snapshot();
  const worker = snap.workers.find((entry) => entry.id === workerId);
  const lines: string[] = [];
  if (worker === undefined) return lines;

  if (worker.description !== undefined && worker.description.length > 0) {
    lines.push(`goal  ${worker.description}`);
  }
  if (worker.focusTodo !== undefined && worker.focusTodo.length > 0) {
    lines.push(`focus ${worker.focusTodo}`);
  }
  if (worker.liveText !== undefined && worker.liveText.length > 0) {
    const kind = worker.liveKind === 'answer' ? 'answer' : 'think';
    lines.push(`${kind} ${worker.liveText}`);
  }
  if (worker.lastTool !== undefined) {
    const target = worker.lastTarget === undefined ? '' : ` ${worker.lastTarget}`;
    lines.push(`tool  ${worker.lastTool}${target}`);
  }
  if (worker.error !== undefined) {
    lines.push(`error ${worker.error}`);
  }
  for (const op of snap.ops) {
    if (op.workerId !== workerId) continue;
    const mark = op.status === 'running' ? '▸' : op.status === 'error' ? '✗' : '✓';
    const target = op.target === undefined ? '' : ` ${op.target}`;
    const chip = op.chip === undefined ? '' : ` ${op.chip}`;
    lines.push(`${mark} ${op.name}${target}${chip}`);
  }
  return lines;
}
