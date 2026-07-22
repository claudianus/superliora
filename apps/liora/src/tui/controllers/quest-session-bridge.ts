/**
 * Quest Session Bridge — maps live session + background tasks to quest entities.
 *
 * The bridge translates the TUI's runtime state (current session streaming
 * phase, background task map) into Quest entities that the bento dashboard
 * can display. Called on dashboard open and refreshed on relevant events.
 *
 * Mapping:
 * - The main interactive session → one quest (state from streamingPhase).
 * - Each background task → one quest (state from task status).
 *
 * Gen 1 scope: read-only snapshot bridge. Live event-driven updates are Gen 2.
 */

import type { BackgroundTaskInfo } from '@superliora/sdk';

import type { QuestGridController } from './quest-grid-controller';
import type { AttentionController } from './attention-controller';
import type { Quest, QuestState } from './quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestBridgeSnapshot {
  /** Current session id. */
  readonly sessionId: string;
  /** Current session title (or fallback). */
  readonly sessionTitle: string;
  /** Current streaming phase of the main session. */
  readonly streamingPhase: 'idle' | 'waiting' | 'thinking' | 'composing' | 'shell';
  /** Whether the main session has a pending approval. */
  readonly approvalPending: boolean;
  /** Whether compaction is in progress. */
  readonly isCompacting: boolean;
  /** Background tasks from session-event-handler. */
  readonly backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>;
  /** Current work directory. */
  readonly workDir: string;
  /** Accumulated file change count for the main session (Gen 5). */
  readonly sessionChangeCount: { added: number; removed: number };
  /** Live description of what the main session is doing now (Gen 7). */
  readonly currentActivity: string | undefined;
}

// ---------------------------------------------------------------------------
// State Mapping
// ---------------------------------------------------------------------------

/** Map a background task status to a QuestState. */
export function mapTaskStatusToQuestState(
  status: BackgroundTaskInfo['status'],
): QuestState {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
    case 'timed_out':
    case 'killed':
    case 'lost':
      return 'failed';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Map the main session's streaming phase to a QuestState. */
export function mapStreamingPhaseToQuestState(
  phase: QuestBridgeSnapshot['streamingPhase'],
  approvalPending: boolean,
  isCompacting: boolean,
): QuestState {
  if (approvalPending) return 'waiting-approval';
  if (isCompacting) return 'blocked';
  switch (phase) {
    case 'idle':
      return 'idle';
    case 'waiting':
    case 'thinking':
    case 'composing':
    case 'shell':
      return 'running';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

/**
 * Sync the quest grid controller from a runtime snapshot.
 *
 * Adds new quests, updates existing ones, and removes stale ones.
 * Triggers attention routing for quests that transition into attention states.
 */
export function syncQuestGridFromSnapshot(
  gridController: QuestGridController,
  attentionController: AttentionController,
  snapshot: QuestBridgeSnapshot,
): void {
  const now = Date.now();
  const seenIds = new Set<string>();

  // 1. Main session quest
  const mainQuestId = `session:${snapshot.sessionId}`;
  seenIds.add(mainQuestId);
  const mainState = mapStreamingPhaseToQuestState(
    snapshot.streamingPhase,
    snapshot.approvalPending,
    snapshot.isCompacting,
  );
  const existingMain = gridController.getQuest(mainQuestId);
  const mainPlanStep = describeMainPlanStep(snapshot);
  if (existingMain === undefined) {
    gridController.addQuest({
      id: mainQuestId,
      name: snapshot.sessionTitle || 'Main Session',
      sessionRef: snapshot.sessionId,
      state: mainState,
      createdAt: now,
      lastActivityAt: now,
      changeCount: snapshot.sessionChangeCount,
      planStep: mainPlanStep,
      worktreePath: snapshot.workDir,
      pinned: false,
      approvalPending: snapshot.approvalPending,
    });
    attentionController.onQuestStateChanged(mainQuestId, mainState);
  } else {
    if (existingMain.state !== mainState) {
      gridController.updateQuestState(mainQuestId, mainState);
      attentionController.onQuestStateChanged(mainQuestId, mainState);
    }
    // Gen 5: keep the change statistic live as edits accumulate.
    const cc = existingMain.changeCount;
    const next = snapshot.sessionChangeCount;
    if (cc.added !== next.added || cc.removed !== next.removed) {
      gridController.updateQuestChanges(mainQuestId, next);
    }
    // Gen 7: keep the plan step live so the cell shows current activity.
    if (existingMain.planStep !== mainPlanStep) {
      gridController.updateQuestPlanStep(mainQuestId, mainPlanStep);
    }
  }

  // 2. Background task quests
  for (const [taskId, info] of snapshot.backgroundTasks) {
    const questId = `task:${taskId}`;
    seenIds.add(questId);
    const questState = mapTaskStatusToQuestState(info.status);
    const existing = gridController.getQuest(questId);

    if (existing === undefined) {
      gridController.addQuest({
        id: questId,
        name: info.description || `Task ${taskId.slice(0, 8)}`,
        sessionRef: taskId,
        state: questState,
        createdAt: info.startedAt,
        lastActivityAt: info.endedAt ?? now,
        changeCount: { added: 0, removed: 0 },
        planStep: describeTaskStep(info),
        worktreePath: snapshot.workDir,
        pinned: false,
        approvalPending: false,
      });
      attentionController.onQuestStateChanged(questId, questState);
    } else if (existing.state !== questState) {
      gridController.updateQuestState(questId, questState);
      attentionController.onQuestStateChanged(questId, questState);
    }
  }

  // 3. Remove stale quests (no longer in snapshot)
  for (const quest of gridController.getQuests()) {
    if (!seenIds.has(quest.id)) {
      gridController.removeQuest(quest.id);
    }
  }

  // 4. Update strip blink state
  const totalQuests = gridController.questCount;
  const attentionCount = gridController.getAttentionQuests().length;
  attentionController.updateStripBlink(totalQuests, attentionCount);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeTaskStep(info: BackgroundTaskInfo): string {
  switch (info.kind) {
    case 'agent':
      return info.subagentType
        ? `Sub-agent: ${info.subagentType}`
        : 'Sub-agent running';
    case 'process':
      return `$ ${info.command.slice(0, 60)}`;
    case 'question':
      return `Answering ${info.questionCount} question(s)`;
    default: {
      const _exhaustive: never = info;
      return _exhaustive;
    }
  }
}

/**
 * Gen 7: describe the main session's current plan step. Prefers the live
 * activity (current tool call) when running, falling back to a phase label.
 */
function describeMainPlanStep(snapshot: QuestBridgeSnapshot): string {
  if (snapshot.approvalPending) return 'Awaiting approval';
  if (snapshot.isCompacting) return 'Compacting context';
  if (snapshot.streamingPhase === 'idle') return 'Waiting for input';
  if (snapshot.currentActivity !== undefined && snapshot.currentActivity.length > 0) {
    return snapshot.currentActivity;
  }
  switch (snapshot.streamingPhase) {
    case 'thinking':
      return 'Thinking…';
    case 'composing':
      return 'Composing response…';
    case 'shell':
      return 'Running command…';
    case 'waiting':
      return 'Working…';
    default:
      return 'Working…';
  }
}
