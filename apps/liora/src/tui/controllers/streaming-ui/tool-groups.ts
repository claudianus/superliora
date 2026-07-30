import { AgentGroupComponent } from '../../components/messages/agent-group';
import { ReadGroupComponent } from '../../components/messages/read-group';
import type { ToolCallComponent } from '../../components/messages/tool-call/index';
import type { ToolCallBlockData } from '../../types';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '#/tui/utils/frame-render';

/** Tracks the in-progress solo→group upgrade for a run of same-step tool calls. */
export interface PendingToolGroup<TGroup> {
  readonly turnId: string | undefined;
  readonly step: number;
  solo?: ToolCallComponent;
  group?: TGroup;
}

/**
 * Attempts to fold a consecutive-`Agent`-call run into a single
 * `AgentGroupComponent`. Mirrors `tryAttachReadToolCall` for `Read` calls.
 * Returns the (possibly updated) pending group state alongside whether this
 * tool call was handled (mounted/attached) by this function.
 */
export function tryAttachAgentToolCall(
  state: TUIState,
  toolCall: ToolCallBlockData,
  tc: ToolCallComponent,
  currentStep: number,
  currentTurnId: string | undefined,
  pending: PendingToolGroup<AgentGroupComponent> | null,
): { handled: boolean; pending: PendingToolGroup<AgentGroupComponent> | null } {
  if (toolCall.name !== 'Agent') {
    return { handled: false, pending: null };
  }

  const step = toolCall.step ?? currentStep;
  const turnId = toolCall.turnId ?? currentTurnId;
  let cur = pending;

  if (cur !== null && (cur.step !== step || cur.turnId !== turnId)) {
    cur = null;
  }

  if (cur === null) {
    state.transcriptContainer.addChild(tc);
    requestTUILayoutRender(state);
    return { handled: true, pending: { step, turnId, solo: tc } };
  }

  if (cur.group !== undefined) {
    cur.group.attach(toolCall.id, tc);
    return { handled: true, pending: cur };
  }

  const solo = cur.solo;
  if (solo === undefined) {
    state.transcriptContainer.addChild(tc);
    requestTUILayoutRender(state);
    return { handled: true, pending: { step, turnId, solo: tc } };
  }
  const group = upgradeSoloAgentToGroup(state, solo);
  group.attach(toolCall.id, tc);
  requestTUILayoutRender(state);
  return { handled: true, pending: { step, turnId, group } };
}

function upgradeSoloAgentToGroup(state: TUIState, solo: ToolCallComponent): AgentGroupComponent {
  const group = new AgentGroupComponent(state.ui);
  const children = state.transcriptContainer.children;
  const idx = children.indexOf(solo);
  if (idx >= 0) {
    children[idx] = group;
    state.transcriptContainer.invalidate();
  } else {
    state.transcriptContainer.addChild(group);
  }
  group.attach(solo.toolCallView.id, solo);
  return group;
}

/**
 * Attempts to fold a consecutive-`Read`-call run into a single
 * `ReadGroupComponent`. Mirrors `tryAttachAgentToolCall` for `Agent` calls.
 */
export function tryAttachReadToolCall(
  state: TUIState,
  toolCall: ToolCallBlockData,
  tc: ToolCallComponent,
  currentStep: number,
  currentTurnId: string | undefined,
  pending: PendingToolGroup<ReadGroupComponent> | null,
): { handled: boolean; pending: PendingToolGroup<ReadGroupComponent> | null } {
  if (toolCall.name !== 'Read') {
    return { handled: false, pending: null };
  }

  const step = toolCall.step ?? currentStep;
  const turnId = toolCall.turnId ?? currentTurnId;
  let cur = pending;

  if (cur !== null && (cur.step !== step || cur.turnId !== turnId)) {
    cur = null;
  }

  if (cur === null) {
    state.transcriptContainer.addChild(tc);
    requestTUILayoutRender(state);
    return { handled: true, pending: { step, turnId, solo: tc } };
  }

  if (cur.group !== undefined) {
    cur.group.attach(toolCall.id, tc);
    return { handled: true, pending: cur };
  }

  const solo = cur.solo;
  if (solo === undefined) {
    state.transcriptContainer.addChild(tc);
    requestTUILayoutRender(state);
    return { handled: true, pending: { step, turnId, solo: tc } };
  }
  const group = upgradeSoloReadToGroup(state, solo);
  group.attach(toolCall.id, tc);
  requestTUILayoutRender(state);
  return { handled: true, pending: { step, turnId, group } };
}

function upgradeSoloReadToGroup(state: TUIState, solo: ToolCallComponent): ReadGroupComponent {
  const group = new ReadGroupComponent(state.ui);
  const children = state.transcriptContainer.children;
  const idx = children.indexOf(solo);
  if (idx >= 0) {
    children[idx] = group;
    state.transcriptContainer.invalidate();
  } else {
    state.transcriptContainer.addChild(group);
  }
  group.attach(solo.toolCallView.id, solo);
  return group;
}
