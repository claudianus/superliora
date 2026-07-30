import type { Session } from '@superliora/sdk';

import {
  UltraworkTheatreComponent,
  ultraworkTheatreRunId,
  type UltraworkTheatreEvent,
} from '../../components/messages/ultrawork-theatre';
import { UltraworkModeMarkerComponent } from '../../components/messages/ultrawork-markers';
import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { SubAgentEventHandler } from '../subagent-event/handler';

/** Host surface required by ultrawork theatre event handling. */
export interface UltraworkEventHost {
  state: TUIState;
  requireSession(): Session;
  setAppState(patch: Partial<AppState>): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
}

export class SessionEventUltrawork {
  ultraworkTheatres: Map<string, UltraworkTheatreComponent> = new Map();
  private ultraworkCompletionHandledRuns: Set<string> = new Set();

  constructor(
    private readonly host: UltraworkEventHost,
    private readonly subAgentEventHandler: SubAgentEventHandler,
  ) {}

  resetRuntimeState(): void {
    this.ultraworkTheatres.clear();
    this.ultraworkCompletionHandledRuns.clear();
  }

  handleEvent(event: UltraworkTheatreEvent): void {
    if (
      event.type === 'ultrawork.stage.changed' &&
      // to='done' is the normal completion path; run.status='failed' covers
      // the terminal event cancel() now emits (stage is unchanged, so only
      // the run status marks it terminal). Both must restore prior state.
      (event.to === 'done' || event.run.status === 'failed')
    ) {
      this.finishRun(event);
    }
    if (event.type === 'ultrawork.team.staffed') {
      this.subAgentEventHandler.handleUltraworkTeamStaffed(event);
    }

    // Collaboration chat feed owns a single sink: AgentSwarmProgress when active.
    // Debate/steer also paint the war-room reel when a swarm is live; theatre remains
    // the fallback surface only when no swarm progress owns the event.
    let collaborationFeedOwnedBySwarm = false;
    if (event.type === 'ultrawork.collaboration.message') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationMessage(event);
    }
    if (event.type === 'ultrawork.collaboration.mention') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationMention(event) ||
        collaborationFeedOwnedBySwarm;
    }
    if (event.type === 'ultrawork.collaboration.debate') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationDebate(event) ||
        collaborationFeedOwnedBySwarm;
    }
    if (event.type === 'ultrawork.collaboration.steer') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationSteer(event) ||
        collaborationFeedOwnedBySwarm;
    }
    if (
      collaborationFeedOwnedBySwarm &&
      (event.type === 'ultrawork.collaboration.message' ||
        event.type === 'ultrawork.collaboration.mention' ||
        event.type === 'ultrawork.collaboration.debate' ||
        event.type === 'ultrawork.collaboration.steer')
    ) {
      requestTUILayoutRender(this.host.state);
      return;
    }

    const runId = ultraworkTheatreRunId(event);
    const existing = this.ultraworkTheatres.get(runId);
    if (existing === undefined) {
      const theatre = new UltraworkTheatreComponent(event);
      this.ultraworkTheatres.set(runId, theatre);
      this.host.state.transcriptContainer.addChild(theatre);
    } else {
      existing.applyEvent(event);
    }
    requestTUILayoutRender(this.host.state);
  }

  private finishRun(event: Extract<UltraworkTheatreEvent, { type: 'ultrawork.stage.changed' }>): void {
    const runId = event.run.id;
    if (this.ultraworkCompletionHandledRuns.has(runId)) return;
    this.ultraworkCompletionHandledRuns.add(runId);

    // Restore the session flags the run took over, if we captured them at
    // start. Without a snapshot (e.g. a run resumed from a prior session) we
    // fall back to turning everything off, matching the prior behaviour.
    const prior = this.host.state.appState.ultraworkPriorState ?? null;
    const restorePlanMode = prior?.planMode ?? false;
    const restoreSwarmMode = prior?.swarmMode ?? false;
    const restorePremiumQuality = prior?.premiumQualityMode ?? false;
    this.host.state.swarmModeEntry = prior?.swarmModeEntry;
    this.host.setAppState({
      ultraworkMode: false,
      planMode: restorePlanMode,
      swarmMode: restoreSwarmMode,
      premiumQualityMode: restorePremiumQuality,
      activityTip: null,
      ultraworkPriorState: null,
    });
    const session = this.host.requireSession();
    void session.setPlanMode(restorePlanMode, false).catch(() => {});
    if (prior === null || prior.swarmMode !== restoreSwarmMode) {
      void session.setSwarmMode(restoreSwarmMode, 'task').catch(() => {});
    }
    void session.setPremiumQuality(restorePremiumQuality).catch(() => {});

    const failed = event.run.status === 'failed';
    const reason = event.reason?.trim();
    const objective = event.run.objective.trim();
    this.host.state.transcriptContainer.addChild(
      new UltraworkModeMarkerComponent({
        state: 'ended',
        taskDescription: objective,
      }),
    );
    this.host.showNotice(
      failed ? 'Ultrawork ended' : 'Ultrawork completed',
      [
        objective,
        reason !== undefined && reason.length > 0
          ? reason
          : failed
            ? 'Run cancelled or failed.'
            : 'All stages finished successfully.',
        'Ultrawork mode is off. Use Shift-Tab or /ultrawork to start another run.',
      ].join('\n'),
      { coalesceKey: `ultrawork-completed:${runId}` },
    );
    requestTUILayoutRender(this.host.state);
  }
}
