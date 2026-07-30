import type { Session } from '@superliora/sdk';

import { formatErrorMessage } from '../../utils/event-payload';
import { flushSuppressedTUIFrame } from '../../utils/render/frame-render';
import { autoResumeUltraworkFromSession } from '../../commands/ultrawork/ultrawork';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import { isMotionTheatreActive } from '#/tui/utils/render/motion-beats';
import { ttui } from '#/tui/utils/tui-i18n';
import { SessionReplayHydrator } from './hydrate';
import { SessionReplayMessageRenderer } from './message-render';
import { SessionReplayRecordRenderer } from './record-render';
import { SessionReplayToolContext } from './tool-context';
import type { SessionLoadingProgress, SessionReplayHost } from './types';

export type { SessionLoadingProgress, SessionReplayHost } from './types';

export class SessionReplayRenderer {
  private readonly hydrator: SessionReplayHydrator;
  private readonly tools: SessionReplayToolContext;
  private readonly messages: SessionReplayMessageRenderer;
  private readonly records: SessionReplayRecordRenderer;

  constructor(private readonly host: SessionReplayHost) {
    this.tools = new SessionReplayToolContext(host);
    this.messages = new SessionReplayMessageRenderer(host, this.tools);
    this.records = new SessionReplayRecordRenderer(host, this.tools, this.messages);
    this.hydrator = new SessionReplayHydrator(host);
  }

  async hydrateFromReplay(session: Session): Promise<boolean> {
    // Host may already own the loading modal (resume RPC). If not, open one here.
    const ownsLoading = !this.host.isSessionLoadingOverlayActive();
    if (ownsLoading) {
      this.host.beginSessionLoading(session.id);
    } else {
      this.host.setAppState({ isReplaying: true });
      this.host.reportSessionLoading({
        phase: 'building',
        sessionId: session.id,
        detail: ttui('tui.sessionLoading.phase.building'),
      });
    }

    this.host.state.transcriptContainer.dismissIdleStage();
    // Bulk-mount: defer per-child invalidate / frame thrash until the tree is built.
    this.host.state.transcriptContainer.beginBatchMount();
    this.host.motionBeats.play({
      name: 'session_resume',
      title: 'Resuming session',
      seed: 'resume',
      nowMs: appearanceAnimationNow(),
      theatreActive: isMotionTheatreActive(this.host.state.appState),
    });
    try {
      const main = session.getResumeState()?.agents['main'];
      if (main === undefined) {
        this.host.showError('Session history is unavailable for this session.');
        return false;
      }

      this.hydrator.hydrateSnapshot(main);
      this.host.reportSessionLoading({
        phase: 'building',
        progress: 0.45,
        detail: ttui('tui.sessionLoading.phase.building'),
      });
      await this.records.renderRecords(main, (patch) => {
        this.host.reportSessionLoading(patch);
      });
      this.hydrator.applyTerminalBackgroundAgentStatuses(main);
      this.host.reportSessionLoading({
        phase: 'finishing',
        progress: 0.92,
        detail: ttui('tui.sessionLoading.phase.finishing'),
      });
      this.host.mergeAllTurnSteps();
      await this.autoResumeUltraworkIfNeeded(session);
      this.host.reportSessionLoading({
        phase: 'ready',
        progress: 1,
        detail: ttui('tui.sessionLoading.phase.ready'),
      });
      return true;
    } catch (error) {
      const message = formatErrorMessage(error);
      this.host.showError(`Failed to replay session history: ${message}`);
      return false;
    } finally {
      this.host.state.transcriptContainer.endBatchMount();
      // One layout pass after the batch (mid-hydrate frames were suppressed).
      flushSuppressedTUIFrame(this.host.state, 'layout');
      if (ownsLoading) {
        this.host.endSessionLoading();
      }
    }
  }

  private async autoResumeUltraworkIfNeeded(session: Session): Promise<void> {
    try {
      await autoResumeUltraworkFromSession(this.host as unknown as SlashCommandHost, session);
    } catch {
      // Best-effort auto-resume only.
    }
  }
}
