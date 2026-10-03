import type { ResumedAgentState } from '@superliora/sdk';

import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  appStateFromResumeAgent,
  countActiveBackgroundTasks,
  isTerminalBackgroundTask,
  replayBackgroundProjection,
} from '../../utils/session/message-replay';
import type { SessionReplayHost } from './types';

export class SessionReplayHydrator {
  constructor(private readonly host: SessionReplayHost) {}

  hydrateSnapshot(agent: ResumedAgentState): void {
    this.host.setAppState(appStateFromResumeAgent(agent));
    this.hydrateBackgroundState(agent);
  }

  /**
   * Push real terminal status into each replayed `Agent` card whose
   * backing background task is already in a terminal state. Runs AFTER
   * `renderRecords` because the tool call components only exist once the
   * replay has mounted them — `hydrateBackgroundState` runs too early to
   * reach them. Without this, terminated bg agents (including ones that
   * reconcile reclassified as `lost`) keep the spawn-success ToolResult's
   * default of `✓ Completed`.
   */
  applyTerminalBackgroundAgentStatuses(agent: ResumedAgentState): void {
    for (const info of agent.background) {
      if (info.kind !== 'agent') continue;
      if (!isTerminalBackgroundTask(info)) continue;
      const status = info.status;
      if (
        status !== 'completed' &&
        status !== 'failed' &&
        status !== 'timed_out' &&
        status !== 'killed' &&
        status !== 'lost'
      ) {
        continue;
      }
      this.host.streamingUI.applyBackgroundTaskTerminalStatus({
        agentId: info.agentId,
        description: info.description,
        status,
      });
    }
  }


  private hydrateBackgroundState(agent: ResumedAgentState): void {
    const { state, sessionEventHandler } = this.host;
    const projection = replayBackgroundProjection(agent.background);
    sessionEventHandler.subAgentEventHandler.backgroundAgentMetadata = new Map(
      projection.backgroundAgentMetadata,
    );
    sessionEventHandler.backgroundTasks.clear();
    for (const info of agent.background) {
      sessionEventHandler.backgroundTasks.set(info.taskId, info);
    }
    sessionEventHandler.backgroundTaskTranscriptedTerminal.clear();
    for (const info of agent.background) {
      if (isTerminalBackgroundTask(info)) {
        sessionEventHandler.backgroundTaskTranscriptedTerminal.add(info.taskId);
      }
    }
    state.footer.setBackgroundCounts(countActiveBackgroundTasks(sessionEventHandler.backgroundTasks));
    this.host.updateActivityPane();
    requestTUILayoutRender(state);
  }
}
