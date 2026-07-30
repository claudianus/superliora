import type { Component, Focusable } from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';
import type { GoalChange, GoalUpdatedEvent, Session } from '@superliora/sdk';

import { buildGoalMarker } from '../../components/messages/goal-markers';
import { createGoal as startGoalCommand } from '../../commands/goal';
import {
  readGoalQueue,
  removeGoalQueueItem,
  restoreGoalQueueItem,
  type UpcomingGoal,
} from '../../goal-queue-store';
import type { AppState, QueuedMessage, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import {
  notifyGoalBlockedAttention,
  notifyGoalCompletedAttention,
} from '../../utils/attention-notifications';
import { appearanceAnimationNow } from '../../utils/appearance-effects';
import { feedbackEffectsActive, noteSuccessFeedback } from '../../utils/feedback-vfx';
import { formatErrorMessage } from '../../utils/event-payload';
import { buildGoalCompletionMessage } from '../../utils/goal-completion';
import { isMotionTheatreActive, type MotionBeatController } from '../../utils/motion-beats';
import { requestTUILayoutRender } from '../../utils/frame-render';
import { noteGoalCompletionMeteorBurst } from '../../utils/stage-letterbox-sky';
import { nextTranscriptId } from '../../utils/transcript-id';

/** Host surface required by goal-updated / queued-goal promotion handling. */
export interface GoalQueueEventHost {
  state: TUIState;
  session: Session | undefined;
  aborted: boolean;
  readonly motionBeats: MotionBeatController;
  requireSession(): Session;
  setAppState(patch: Partial<AppState>): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  track(event: string, props?: Record<string, unknown>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  sendNormalUserInput(text: string): void;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
}

/**
 * Shared flags owned by SessionEventHandler because turn handlers also
 * read/write them (turn.ended, assistant.delta). Injected so goal-queue
 * promotion stays coordinated without relocating turn-owned state.
 */
export interface GoalQueueSharedFlags {
  getGoalCompletionTurnEnded(): boolean;
  setGoalCompletionTurnEnded(value: boolean): void;
  getCurrentTurnHasAssistantText(): boolean;
  setPendingModelBlockedFallback(value: GoalChange | undefined): void;
}

export class SessionEventGoalQueue {
  private goalCompletionAwaitingClear = false;
  private queuedGoalPromotionPending = false;
  private queuedGoalPromotionInFlight = false;
  private queuedGoalPromotionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly host: GoalQueueEventHost,
    private readonly flags: GoalQueueSharedFlags,
  ) {}

  resetRuntimeState(): void {
    this.goalCompletionAwaitingClear = false;
    this.queuedGoalPromotionPending = false;
    this.queuedGoalPromotionInFlight = false;
    this.clearQueuedGoalPromotionTimer();
  }

  handleUpdated(event: GoalUpdatedEvent): void {
    this.host.setAppState({ goal: event.snapshot });
    if (event.snapshot === null && this.goalCompletionAwaitingClear) {
      this.goalCompletionAwaitingClear = false;
      this.queuedGoalPromotionPending = true;
      this.scheduleQueuedGoalPromotion();
    }
    if (event.snapshot === null) {
      this.flags.setPendingModelBlockedFallback(undefined);
    }
    const change = event.change;
    if (change === undefined) return;
    const { state } = this.host;

    // Completion -> the box disappears (snapshot cleared on the follow-up null
    // update) and a deterministic completion message lands in the transcript.
    // Resume renders the same text from the durable goal completion replay
    // record, so live and replayed completion cards stay identical.
    if (change.kind === 'completion' && event.snapshot !== null) {
      this.flags.setPendingModelBlockedFallback(undefined);
      this.goalCompletionAwaitingClear = true;
      this.flags.setGoalCompletionTurnEnded(false);
      notifyGoalCompletedAttention(state, event.snapshot);
      noteSuccessFeedback();
      if (feedbackEffectsActive()) {
        noteGoalCompletionMeteorBurst(appearanceAnimationNow());
      }
      this.host.motionBeats.play({
        name: 'goal_complete',
        seed: `goal:${event.snapshot.goalId}`,
        title: 'Goal complete',
        nowMs: appearanceAnimationNow(),
        theatreActive: isMotionTheatreActive(state.appState),
      });
      this.host.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'assistant',
        renderMode: 'markdown',
        content: buildGoalCompletionMessage(event.snapshot),
      });
      requestTUILayoutRender(state);
      return;
    }

    // Lifecycle change (pause / resume / blocked) -> a low-profile,
    // ctrl+o-expandable marker.
    if (change.kind === 'lifecycle' && change.status === 'blocked') {
      if (event.snapshot !== null) {
        notifyGoalBlockedAttention(state, event.snapshot, change.reason);
      }
      void this.notifyQueuedGoalWaitingOnBlocked();
      if (change.actor === 'model' || change.reason === undefined) {
        this.flags.setPendingModelBlockedFallback(
          this.flags.getCurrentTurnHasAssistantText() ? undefined : change,
        );
        return;
      }
      this.flags.setPendingModelBlockedFallback(undefined);
    } else if (change.kind === 'lifecycle') {
      this.flags.setPendingModelBlockedFallback(undefined);
    }
    const marker = buildGoalMarker(change, state.toolOutputExpanded, change.actor);
    if (marker !== null) {
      state.transcriptContainer.addChild(marker);
      requestTUILayoutRender(state);
    }
  }

  scheduleQueuedGoalPromotion(): void {
    if (!this.queuedGoalPromotionPending || !this.flags.getGoalCompletionTurnEnded()) return;
    if (this.queuedGoalPromotionInFlight) return;
    if (this.queuedGoalPromotionTimer !== undefined) return;
    this.queuedGoalPromotionTimer = setTimeout(() => {
      this.queuedGoalPromotionTimer = undefined;
      if (!this.queuedGoalPromotionPending || !this.flags.getGoalCompletionTurnEnded()) return;
      if (this.queuedGoalPromotionInFlight) return;
      if (!this.isReadyForQueuedGoalPromotion()) {
        return;
      }
      this.queuedGoalPromotionInFlight = true;
      void this.promoteNextQueuedGoal()
        .then((complete) => {
          if (complete) {
            this.queuedGoalPromotionPending = false;
            this.flags.setGoalCompletionTurnEnded(false);
            return;
          }
          this.flags.setGoalCompletionTurnEnded(false);
        })
        .finally(() => {
          this.queuedGoalPromotionInFlight = false;
          this.scheduleQueuedGoalPromotion();
        });
    }, 0);
    this.queuedGoalPromotionTimer.unref?.();
  }

  private clearQueuedGoalPromotionTimer(): void {
    if (this.queuedGoalPromotionTimer === undefined) return;
    clearTimeout(this.queuedGoalPromotionTimer);
    this.queuedGoalPromotionTimer = undefined;
  }

  requestQueuedGoalPromotion(): void {
    this.queuedGoalPromotionPending = true;
    this.flags.setGoalCompletionTurnEnded(true);
    this.scheduleQueuedGoalPromotion();
  }

  retryQueuedGoalPromotion(): void {
    this.scheduleQueuedGoalPromotion();
  }

  private isReadyForQueuedGoalPromotion(session?: Session): boolean {
    return (
      (session === undefined || this.host.session === session) &&
      !this.host.aborted &&
      this.host.state.appState.streamingPhase === 'idle' &&
      this.host.state.queuedMessages.length === 0
    );
  }

  private async promoteNextQueuedGoal(): Promise<boolean> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || host.aborted) return true;

    let queue;
    try {
      queue = await readGoalQueue(session);
    } catch (error) {
      host.showError(`Failed to read upcoming goals: ${formatErrorMessage(error)}`);
      return false;
    }
    if (host.session !== session || host.aborted) return true;

    const next = queue.goals[0];
    if (next === undefined) return true;

    if (!this.isReadyForQueuedGoalPromotion(session)) return false;

    const started = await startGoalCommand(
      host,
      { kind: 'create', objective: next.objective, replace: false },
      next.objective,
      {
        skipPermissionPrompt: true,
        beforeSend: async () => {
          if (!this.isReadyForQueuedGoalPromotion(session)) {
            await this.cancelStartedQueuedGoal(session);
            return false;
          }
          try {
            await removeGoalQueueItem(session, { goalId: next.id });
          } catch (error) {
            host.showError(
              `Queued goal started, but could not be removed from the queue: ${formatErrorMessage(error)}`,
            );
            await this.cancelStartedQueuedGoal(session);
            return false;
          }
          if (this.isReadyForQueuedGoalPromotion(session)) {
            return true;
          }
          await this.restoreAndCancelStartedQueuedGoal(session, next);
          return false;
        },
        sendInput: (objective) => {
          host.sendQueuedMessage(session, { text: objective });
        },
      },
    );
    return started || host.session !== session || host.aborted;
  }

  private async restoreAndCancelStartedQueuedGoal(
    session: Session,
    goal: UpcomingGoal,
  ): Promise<void> {
    try {
      await restoreGoalQueueItem(session, goal);
    } catch (error) {
      this.host.showError(`Queued goal could not be restored: ${formatErrorMessage(error)}`);
    }
    await this.cancelStartedQueuedGoal(session);
  }

  private async cancelStartedQueuedGoal(session: Session): Promise<void> {
    try {
      await session.cancelGoal();
    } catch (error) {
      this.host.showError(`Queued goal could not be cancelled: ${formatErrorMessage(error)}`);
    }
  }

  private async notifyQueuedGoalWaitingOnBlocked(): Promise<void> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || host.aborted) return;

    let hasQueuedGoal = false;
    try {
      const queue = await readGoalQueue(session);
      hasQueuedGoal = queue.goals.length > 0;
    } catch {
      return;
    }
    if (!hasQueuedGoal || host.session !== session || host.aborted) return;

    host.showNotice(
      'Goal blocked.',
      'The next queued goal will start only after this goal is complete.',
    );
  }
}
