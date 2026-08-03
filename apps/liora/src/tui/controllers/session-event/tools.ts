import type {
  Event,
  ToolCallDeltaEvent,
  ToolCallStartedEvent,
  ToolProgressEvent,
  ToolResultEvent,
} from '@superliora/sdk';

import { isSwarmProgressToolName } from '../../components/messages/agent-swarm-progress/index';
import type {
  AppState,
  LivePaneState,
  ToolCallBlockData,
  ToolResultBlockData,
} from '../../types';
import type { TUIState } from '../../tui-state';
import {
  argsRecord,
  isTodoItemShape,
  serializeToolResultOutput,
} from '../../utils/event-payload';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import {
  isMotionTheatreActive,
  type MotionBeatController,
} from '../../utils/render/motion-beats';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { searchCascadePatchFromToolResult } from '../../utils/search/search-cascade';
import { goalSoftAdvisoryPatchFromToolResult } from '../../utils/goal/goal-soft-advisory-glance';
import {
  formatCircuitBreakerOpenNotice,
  formatCircuitBreakerRecoveredNotice,
  isCircuitBreakerOpenOutput,
  isCircuitBreakerRecoveredOutput,
} from '../../utils/tools/circuit-breaker-notice';
import {
  formatDoomLoopHardStopNotice,
  formatDoomLoopSoftWarnNotice,
  isDoomLoopHardStopOutput,
  isDoomLoopSoftWarnOutput,
} from '../../utils/tools/doom-loop-notice';
import {
  formatIdempotencyReplayNotice,
  isIdempotencyReplayOutput,
} from '../../utils/tools/idempotency-notice';
import {
  formatSameStepDedupNotice,
  isSameStepDedupOutput,
} from '../../utils/tools/same-step-dedup-notice';
import {
  formatShellDedicatedBypassNotice,
  isShellDedicatedBypassOutput,
} from '../../utils/tools/shell-dedicated-bypass-notice';
import {
  formatShellSensitivePathNotice,
  isShellSensitivePathOutput,
} from '../../utils/tools/shell-sensitive-path-notice';
import {
  formatPathSecurityNotice,
  isPathSecurityOutput,
} from '../../utils/tools/path-security-notice';
import {
  formatAutoCheckSpawnNotice,
  isAutoCheckSpawnOutput,
} from '../../utils/tools/auto-check-spawn-notice';
import {
  formatGoalFalseCompleteNotice,
  formatGoalSoftAdvisoryNotice,
  isGoalFalseCompleteOutput,
  isGoalSoftAdvisoryOutput,
} from '../../utils/tools/goal-completion-notice';
import {
  extractMutationPackageDir,
  formatMutationVerifyNotice,
  isMutationVerifyNudgeOutput,
} from '../../utils/tools/mutation-verify-notice';
import {
  formatSlowToolWarnNotice,
  isSlowToolWarnOutput,
} from '../../utils/tools/slow-tool-notice';
import type { StreamingUIController } from '../streaming-ui/index';

const CONDUCTOR_JOB_TOOLS = new Set([
  'JobCreate',
  'JobList',
  'JobInspect',
  'JobSteer',
  'JobCancel',
  'MergeJob',
  'JobSchedule',
  'JobResume',
  'JobInbox',
]);

/** Host surface required by tool / shell event handling. */
export interface ToolsEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  readonly motionBeats?: MotionBeatController;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void;
  handleShellStarted(event: { commandId: string; taskId: string }): void;
  /** Optional — doom-loop hard stop recovery notice (Loop24a). */
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  showStatus?(msg: string, color?: string): void;
  /** Conductor job desk sink; Job* tool output backfills through the board store. */
  readonly controlTowerDesk?: { applyToolOutput(output: string): boolean };
}

/**
 * Swarm-progress tool fan-out lives on SubAgentEventHandler. Injected so tool
 * call / delta / result handling stays coordinated without importing the
 * sibling handler graph into this module.
 */
export interface ToolsEventCoordination {
  handleAgentSwarmToolCallStarted(
    toolCallId: string,
    args: Record<string, unknown>,
    name: string,
  ): void;
  handleAgentSwarmToolCallDelta(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string | undefined },
    name: string,
  ): void;
  hasAgentSwarmProgress(toolCallId: string): boolean;
  handleAgentSwarmToolResult(
    toolCallId: string,
    resultData: ToolResultBlockData,
    isError: boolean,
  ): void;
}

export class SessionEventTools {
  constructor(
    private readonly host: ToolsEventHost,
    private readonly coordination: ToolsEventCoordination,
  ) {}

  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void {
    this.host.handleShellOutput(event);
  }

  handleShellStarted(event: { commandId: string; taskId: string }): void {
    this.host.handleShellStarted(event);
  }

  handleToolCall(event: ToolCallStartedEvent): void {
    const { state, streamingUI } = this.host;
    streamingUI.flushNow();
    const { turnId, step } = streamingUI.getTurnContext();
    const toolCall: ToolCallBlockData = {
      id: event.toolCallId,
      name: event.name,
      args: argsRecord(event.args),
      description: event.description,
      display: event.display,
      step,
      turnId,
    };
    streamingUI.registerToolCall(toolCall);
    // Push to activity feed for transparency panel
    if (event.name !== 'TodoList') {
      state.todoPanel.bumpActivity();
      requestTUILayoutRender(state);
    }
    if (isSwarmProgressToolName(event.name)) {
      this.coordination.handleAgentSwarmToolCallStarted(
        event.toolCallId,
        toolCall.args,
        event.name,
      );
    }
    this.host.patchLivePane({
      mode: 'tool',
      pendingApproval: null,
      pendingQuestion: null,
    });
  }

  handleToolCallDelta(event: ToolCallDeltaEvent): void {
    if (event.toolCallId.length === 0) return;
    const { state, streamingUI } = this.host;
    streamingUI.accumulateToolCallDelta(event.toolCallId, event.name, event.argumentsPart);
    const preview = streamingUI.getStreamingToolCallPreview(event.toolCallId);
    if (
      preview !== undefined &&
      (isSwarmProgressToolName(preview.name) ||
        this.coordination.hasAgentSwarmProgress(event.toolCallId))
    ) {
      this.coordination.handleAgentSwarmToolCallDelta(
        event.toolCallId,
        preview.args,
        { streamingArguments: preview.argumentsText },
        preview.name,
      );
    }

    this.host.patchLivePane({
      mode: 'tool',
      pendingApproval: null,
      pendingQuestion: null,
    });
    if (state.appState.streamingPhase !== 'composing') {
      this.host.setAppState({ streamingPhase: 'composing', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  handleToolProgress(event: ToolProgressEvent): void {
    const text = event.update.text;
    if (text === undefined || text.length === 0) return;
    const tc = this.host.streamingUI.getToolComponent(event.toolCallId);
    if (tc === undefined) return;
    if (event.update.kind === 'status') {
      tc.appendProgress(text);
      return;
    }
    if (event.update.kind === 'stdout' || event.update.kind === 'stderr') {
      tc.appendLiveOutput(text);
    }
  }

  handleToolResult(event: ToolResultEvent): void {
    const { streamingUI } = this.host;
    streamingUI.flushNow();
    const resultData: ToolResultBlockData = {
      tool_call_id: event.toolCallId,
      output: serializeToolResultOutput(event.output),
      is_error: event.isError,
      synthetic: event.synthetic,
    };
    const matchedCall = streamingUI.completeToolResult(event.toolCallId, resultData);
    // Push result to activity feed

    this.coordination.handleAgentSwarmToolResult(
      event.toolCallId,
      resultData,
      event.isError === true,
    );
    if (matchedCall !== undefined) {
      const cascadePatch = searchCascadePatchFromToolResult(matchedCall.name, resultData.output);
      if (cascadePatch !== null) {
        this.host.setAppState(cascadePatch);
        this.host.motionBeats?.play({
          name: 'tool_settle',
          seed: 'research-cascade',
          title: 'Research cascade',
          nowMs: appearanceAnimationNow(),
          streamThrottle: true,
          theatreActive: isMotionTheatreActive(this.host.state.appState),
        });
      }
      const advisoryPatch = goalSoftAdvisoryPatchFromToolResult(
        this.host.state.appState.sessionId,
        matchedCall.name,
        matchedCall.args,
        event.isError === true,
        resultData.output,
      );
      if (advisoryPatch.goalSoftAdvisory !== this.host.state.appState.goalSoftAdvisory) {
        this.host.setAppState(advisoryPatch);
      }
    }
    if (matchedCall !== undefined && matchedCall.name === 'TodoList' && !event.isError) {
      const rawTodos = (matchedCall.args as { todos?: unknown }).todos;
      if (Array.isArray(rawTodos)) {
        const sanitized = rawTodos
          .filter((todo): todo is { title: string; status: 'pending' | 'in_progress' | 'done' } =>
            isTodoItemShape(todo),
          )
          .map((t) => ({ title: t.title, status: t.status }));
        streamingUI.setTodoList(sanitized);
      }
    }
    // Conductor Job desk — best-effort tool-text backfill converges on the
    // board store (V5-3 single source).
    if (
      matchedCall !== undefined &&
      CONDUCTOR_JOB_TOOLS.has(matchedCall.name) &&
      event.isError !== true
    ) {
      const applied = this.host.controlTowerDesk?.applyToolOutput(resultData.output) ?? false;
      if (applied) {
        if (
          matchedCall.name === 'JobCreate' ||
          matchedCall.name === 'JobResume' ||
          matchedCall.name === 'JobCancel'
        ) {
          this.host.motionBeats?.play({
            name: 'tool_settle',
            seed: 'conductor-job',
            title: 'Job desk',
            nowMs: appearanceAnimationNow(),
            streamThrottle: true,
            theatreActive: isMotionTheatreActive(this.host.state.appState),
          });
        }
      }
    }
    // Loop24a/b + Loop25a + Loop26b: named recovery notices for engine guard rails.
    if (this.host.showNotice !== undefined) {
      if (event.isError === true && isDoomLoopHardStopOutput(resultData.output)) {
        const notice = formatDoomLoopHardStopNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (event.isError === true && isShellDedicatedBypassOutput(resultData.output)) {
        // Loop43a: Bash blocked in favor of Read/Write/Edit/Grep/Glob.
        const notice = formatShellDedicatedBypassNotice(
          matchedCall?.name,
          resultData.output,
        );
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (event.isError === true && isShellSensitivePathOutput(resultData.output)) {
        // Loop44a: Bash hard-deny for env/credential/SSH paths (no force hatch).
        const notice = formatShellSensitivePathNotice(
          matchedCall?.name,
          resultData.output,
        );
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (event.isError === true && isPathSecurityOutput(resultData.output)) {
        // Loop45a: Read/Write/Edit/Grep/Glob PathSecurityError (PATH_* codes).
        const notice = formatPathSecurityNotice(matchedCall?.name, resultData.output);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (event.isError === true && isCircuitBreakerOpenOutput(resultData.output)) {
        const notice = formatCircuitBreakerOpenNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (
        event.isError !== true &&
        isCircuitBreakerRecoveredOutput(resultData.output)
      ) {
        // Loop29a: half-open/open → closed after successful probe.
        const notice = formatCircuitBreakerRecoveredNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'info');
      } else if (isDoomLoopSoftWarnOutput(resultData.output)) {
        const notice = formatDoomLoopSoftWarnNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (isIdempotencyReplayOutput(resultData.output)) {
        const notice = formatIdempotencyReplayNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'info');
      } else if (isSameStepDedupOutput(resultData.output)) {
        // Loop42a: same-step identical (tool,args) reused prior result.
        const notice = formatSameStepDedupNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'info');
      } else if (isSlowToolWarnOutput(resultData.output)) {
        const notice = formatSlowToolWarnNotice(matchedCall?.name);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (isAutoCheckSpawnOutput(resultData.output)) {
        // Loop33a: opt-in spawn result — prefer over bare mutation-verify when both present.
        const notice = formatAutoCheckSpawnNotice(matchedCall?.name, resultData.output);
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, notice.failed ? 'warning' : 'success');
      } else if (event.isError === true && isGoalFalseCompleteOutput(resultData.output)) {
        // Loop36a: false-complete hard reject on UpdateGoal(complete).
        const notice = formatGoalFalseCompleteNotice();
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'warning');
      } else if (event.isError !== true && isGoalSoftAdvisoryOutput(resultData.output)) {
        // Loop36a: plain Goal complete without evidence hard gate.
        const notice = formatGoalSoftAdvisoryNotice();
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'info');
      } else if (
        event.isError !== true &&
        isMutationVerifyNudgeOutput(resultData.output)
      ) {
        // Loop27b: PostToolUse mutation-verify tip — operator-visible, not model-only.
        const notice = formatMutationVerifyNotice(
          matchedCall?.name,
          extractMutationPackageDir(resultData.output),
        );
        this.host.showNotice(notice.title, notice.detail, {
          coalesceKey: notice.coalesceKey,
        });
        this.host.showStatus?.(notice.status, 'info');
      }
    }
    this.host.patchLivePane({ mode: 'waiting' });
  }

  handleToolsUpdateStore(event: Extract<Event, { type: 'tools.update_store' }>): void {
    if (event.key !== 'todo') return;
    const rawTodos = event.value;
    if (!Array.isArray(rawTodos)) return;
    const sanitized = rawTodos
      .filter((todo): todo is { title: string; status: 'pending' | 'in_progress' | 'done' } =>
        isTodoItemShape(todo),
      )
      .map((todo) => ({ title: todo.title, status: todo.status }));
    this.host.streamingUI.setTodoList(sanitized);
  }
}
