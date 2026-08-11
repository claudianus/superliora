import type { BackgroundTaskInfo, Event } from '@superliora/sdk';

import { MAIN_AGENT_ID } from '../../constant/liora-tui';
import type { BackgroundAgentMetadata } from '../../types';
import { ttui } from '../../utils/tui-i18n';
import type { SessionEventHost } from '../session-event/handler';
import {
  buildBackgroundAgentMetadata,
  buildBackgroundAgentTranscriptEntry,
  findAgentTaskId,
  isSubagentModelFallbackRetry,
  shouldSurfaceSubagentModelNotice,
  subagentModelFailoverNoticeDetail,
} from './background';
import {
  handleForegroundSubagentCompleted,
  handleForegroundSubagentFailed,
  handleForegroundSubagentSpawned,
  handleForegroundSubagentStarted,
  routeChildAgentToolEvent,
} from './foreground-lifecycle';
import {
  isSubagentLifecycleEvent,
  type SubagentLifecycleEvent,
  type SubagentLifecycleEventOf,
} from './helpers';

export interface SubagentInfo {
  readonly parentToolCallId: string;
  readonly name: string;
  readonly runInBackground: boolean;
  readonly modelAlias?: string;
}

export type { SubagentLifecycleEvent };

export interface SubAgentEventHandlerDependencies {
  readonly backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>;
  readonly backgroundTaskTranscriptedTerminal: Set<string>;
  readonly syncBackgroundAgentBadge: () => void;
}

export class SubAgentEventHandler {
  readonly subagentInfo: Map<string, SubagentInfo> = new Map();
  backgroundAgentMetadata: Map<string, BackgroundAgentMetadata> = new Map();

  constructor(
    private readonly host: SessionEventHost,
    private readonly deps: SubAgentEventHandlerDependencies,
  ) {}

  resetRuntimeState(): void {
    this.subagentInfo.clear();
    this.backgroundAgentMetadata.clear();
  }

  routeChildAgentEvent(event: Event): boolean {
    if (isSubagentLifecycleEvent(event)) return false;

    const childAgentId = event.agentId;
    if (childAgentId === MAIN_AGENT_ID) return false;
    if (this.host.btwPanelController.routeEvent(event)) return true;

    const info = this.subagentInfo.get(childAgentId);
    if (info === undefined || info.parentToolCallId.length === 0) return true;

    const { parentToolCallId } = info;
    return routeChildAgentToolEvent(this.host, childAgentId, parentToolCallId, info, event);
  }

  handleLifecycleEvent(event: SubagentLifecycleEvent): void {
    switch (event.type) {
      case 'subagent.spawned':
        this.handleSubagentSpawned(event);
        return;
      case 'subagent.started':
        this.handleSubagentStarted(event);
        return;
      case 'subagent.completed':
        this.handleSubagentCompleted(event);
        return;
      case 'subagent.failed':
        this.handleSubagentFailed(event);
        return;
    }
  }

  private handleSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.rememberSubagent(event);
    this.maybeSurfaceSubagentModel(event);

    if (!event.runInBackground) {
      handleForegroundSubagentSpawned(this.host, event);
      return;
    }

    const meta = buildBackgroundAgentMetadata(
      event,
      this.host.streamingUI.getActiveToolCall(event.parentToolCallId),
    );
    this.backgroundAgentMetadata.set(event.subagentId, meta);
    this.appendBackgroundAgentEntry('started', meta);
    this.deps.syncBackgroundAgentBadge();
  }

  private maybeSurfaceSubagentModel(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    const { appState } = this.host.state;
    if (
      !shouldSurfaceSubagentModelNotice({
        modelAlias: event.modelAlias,
        subagentName: event.subagentName,
        sessionModel: appState.model,
        availableModels: appState.availableModels,
      })
    ) {
      return;
    }
    // Tool-call header already shows `· modelAlias` while the subagent runs.
    const modelAlias = event.modelAlias!;
    const routeBit =
      event.routeReason !== undefined && event.routeReason.length > 0
        ? event.routeReason
        : `subagent:${event.subagentName}`;
    this.host.setAppState({
      lastModelRouteNotice: {
        kind: 'selection',
        fromAlias: appState.model,
        toAlias: modelAlias,
        reason: routeBit,
        atMs: Date.now(),
      },
    });
  }

  private handleSubagentStarted(
    event: SubagentLifecycleEventOf<'subagent.started'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined) return;
    if (!info.runInBackground) {
      handleForegroundSubagentStarted(this.host, event, info);
    }
  }

  private handleSubagentCompleted(
    event: SubagentLifecycleEventOf<'subagent.completed'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info !== undefined && !info.runInBackground) {
      this.host.setAppState({ fleetFlourish: { atMs: Date.now() } });
      handleForegroundSubagentCompleted(this.host, event, info);
      return;
    }

    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = findAgentTaskId(
        event.subagentId,
        backgroundMeta,
        this.deps.backgroundTasks,
      );
      this.backgroundAgentMetadata.delete(event.subagentId);
      this.deps.syncBackgroundAgentBadge();
      if (taskId !== undefined && this.deps.backgroundTaskTranscriptedTerminal.has(taskId)) {
        return;
      }
      if (taskId !== undefined) {
        this.deps.backgroundTaskTranscriptedTerminal.add(taskId);
      }
      const extras =
        event.resultSummary === undefined ? undefined : { resultSummary: event.resultSummary };
      this.appendBackgroundAgentEntry('completed', backgroundMeta, extras);
      return;
    }
  }

  private handleSubagentFailed(
    event: SubagentLifecycleEventOf<'subagent.failed'>,
  ): void {
    // Whole-turn model hop: keep the worker alive and show one concise notice.
    if (this.surfaceModelFallbackRetry(event)) return;

    const info = this.subagentInfo.get(event.subagentId);
    if (info !== undefined && !info.runInBackground) {
      handleForegroundSubagentFailed(this.host, event, info);
      return;
    }

    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = findAgentTaskId(
        event.subagentId,
        backgroundMeta,
        this.deps.backgroundTasks,
      );
      const task = taskId === undefined ? undefined : this.deps.backgroundTasks.get(taskId);
      this.backgroundAgentMetadata.delete(event.subagentId);
      this.deps.syncBackgroundAgentBadge();
      if (task?.kind === 'agent' && task.status === 'timed_out') {
        return;
      }
      this.host.streamingUI.applyBackgroundTaskTerminalStatus({
        agentId: event.subagentId,
        description: backgroundMeta.description ?? '',
        status: 'failed',
        errorText: event.error,
      });
      if (taskId !== undefined && this.deps.backgroundTaskTranscriptedTerminal.has(taskId)) {
        return;
      }
      if (taskId !== undefined) {
        this.deps.backgroundTaskTranscriptedTerminal.add(taskId);
      }
      this.appendBackgroundAgentEntry('failed', backgroundMeta, { error: event.error });
      return;
    }
  }

  /**
   * Non-terminal model-fallback hop (`retryAttempt` set). Paint a short
   * transcript notice instead of treating the worker as failed.
   */
  private surfaceModelFallbackRetry(
    event: SubagentLifecycleEventOf<'subagent.failed'>,
  ): boolean {
    if (!isSubagentModelFallbackRetry(event)) return false;

    const info = this.subagentInfo.get(event.subagentId);
    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    const toAlias = event.fellBackToModel?.trim();
    const fromAlias = info?.modelAlias ?? backgroundMeta?.modelAlias;
    const name = info?.name ?? backgroundMeta?.agentName;
    const availableModels = this.host.state.appState.availableModels;

    if (toAlias !== undefined && toAlias.length > 0) {
      const detail = subagentModelFailoverNoticeDetail({
        subagentName: name,
        fromAlias,
        toAlias,
        availableModels,
      });
      this.host.showNotice(ttui('tui.notice.modelFailover.title'), detail, {
        coalesceKey: `model-route:subagent:${event.subagentId}`,
      });
      this.host.setAppState({
        lastModelRouteNotice: {
          kind: 'failover',
          fromAlias,
          toAlias,
          reason: name !== undefined ? `subagent:${name}` : 'subagent',
          atMs: Date.now(),
        },
      });
      if (info !== undefined) {
        this.subagentInfo.set(event.subagentId, { ...info, modelAlias: toAlias });
      }
      if (backgroundMeta !== undefined) {
        this.backgroundAgentMetadata.set(event.subagentId, {
          ...backgroundMeta,
          modelAlias: toAlias,
        });
      }
    }

    return true;
  }

  private appendBackgroundAgentEntry(
    phase: 'started' | 'completed' | 'failed',
    meta: BackgroundAgentMetadata,
    extras: { resultSummary?: string; error?: string } | undefined = undefined,
  ): void {
    this.host.appendTranscriptEntry(
      buildBackgroundAgentTranscriptEntry(
        phase,
        meta,
        this.host.streamingUI.getTurnContext().turnId,
        extras,
      ),
    );
  }

  private rememberSubagent(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.subagentInfo.set(event.subagentId, {
      parentToolCallId: event.parentToolCallId,
      name: event.subagentName,
      runInBackground: event.runInBackground,
      modelAlias: event.modelAlias,
    });
  }
}

export { isSubagentLifecycleEvent } from './helpers';
