/**
 * `/refine` — run the continual-harness refine pipeline from the TUI.
 *
 *   /refine [instructions...]          run a local refinement
 *   /refine --global [instructions...] refine the cross-session harness
 *   /refine status                     list harness entries + recent refinements
 *   /refine rollback <id>              revert one applied refinement
 */

import type { HarnessStatusView, RefineRunResult } from '@superliora/sdk';

import { UsagePanelComponent } from '../components/messages/usage-panel/index';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUILayoutRender } from '../utils/render/frame-render';
import type { SlashCommandHost } from './hub/dispatch';

const NO_ACTIVE_SESSION_MESSAGE = 'No active session.';

export async function handleRefineCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  const trimmed = args.trim();
  const [subcommand, ...rest] = trimmed.split(/\s+/);

  try {
    if (subcommand === 'status') {
      const view = await session.getHarnessStatus();
      showPanel(host, ' Harness ', renderStatusLines(view));
      return;
    }
    if (subcommand === 'rollback') {
      const refinementId = rest.join(' ').trim();
      if (refinementId.length === 0) {
        host.showError('Usage: /refine rollback <refinementId> (see /refine status)');
        return;
      }
      const event = await session.rollbackRefinement(refinementId);
      host.showStatus(`Rolled back ${event.id}: ${event.kind} ${event.targetId}.`);
      return;
    }

    const global = subcommand === '--global';
    const instructions = (global ? rest.join(' ') : trimmed).trim();
    host.showStatus('Refining the harness…');
    const result = await session.refine({
      scope: global ? 'global' : 'local',
      ...(instructions.length > 0 ? { instructions } : {}),
    });
    showPanel(host, ' Refine ', renderRunLines(result));
  } catch (error) {
    host.showError(`Refine failed: ${formatErrorMessage(error)}`);
  }
}

function showPanel(host: SlashCommandHost, title: string, lines: string[]): void {
  const panel = new UsagePanelComponent(() => lines, 'primary', title);
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

function renderRunLines(result: RefineRunResult): string[] {
  const lines = [`Scope: ${result.scope}`, '', result.summary, ''];
  if (result.applied.length === 0 && result.failed.length === 0) {
    lines.push('No edits proposed — the trajectory showed nothing worth persisting.');
  }
  for (const event of result.applied) {
    lines.push(`applied ${event.id}: ${event.kind} ${event.targetId}`);
  }
  for (const event of result.failed) {
    lines.push(`FAILED ${event.kind} ${event.targetId}: ${event.error ?? 'unknown error'}`);
  }
  if (result.applied.length > 0) {
    lines.push('', 'Rollback: /refine rollback <id>');
  }
  return lines;
}

function renderStatusLines(view: HarnessStatusView): string[] {
  const { snapshot } = view;
  const lines = [
    `Entries: ${String(snapshot.promptNotes)} prompt notes, ${String(snapshot.subagentSpecs)} subagent specs`,
    `Refinements: ${String(snapshot.refinements)} recorded · last run ${snapshot.lastRefinedAt === null ? 'never' : new Date(snapshot.lastRefinedAt).toLocaleString()}`,
    `Auto-refine: ${snapshot.inFlight ? 'running' : `${String(snapshot.turnsSinceRefine)} turns since last run`}`,
    '',
  ];
  if (view.entries.length === 0 && view.refinements.length === 0) {
    lines.push('Nothing yet — /refine reviews the trajectory and proposes edits.');
    return lines;
  }
  for (const entry of view.entries) {
    const score =
      entry.score === undefined
        ? ''
        : ` · gate ${String(entry.score.confirmed)}✓/${String(entry.score.failed)}✗`;
    lines.push(
      `${entry.kind} ${entry.id} "${entry.title}" (${entry.scope}, v${String(entry.version)})${score}`,
    );
  }
  for (const event of view.refinements.slice(-10)) {
    lines.push(`${event.status} ${event.id}: ${event.kind} ${event.targetId}`);
  }
  return lines;
}
