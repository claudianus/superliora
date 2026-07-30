import type { AgentGroupComponent } from '../../components/messages/agent-group';
import type { ReadGroupComponent } from '../../components/messages/read-group';
import type { ThinkingComponent } from '../../components/messages/thinking';
import { ToolCallComponent } from '../../components/messages/tool-call/index';
import type { LivePaneState, ToolCallBlockData } from '../../types';

import {
  settleActiveChainSummary as settleActiveChainSummaryHelper,
  type ChainSummaryState,
} from './chain-summary';
import type { StreamingUIHost } from './host-types';
import {
  shouldSmoothStreamReveal as shouldSmoothStreamRevealHelper,
  type StreamingRevealContext,
  type StreamingRevealRuntime,
} from './reveal';
import type { StreamingTextBlock, TextRenderContext } from './text-render';
import type { ToolRenderContext } from './tool-render';
import type { PendingToolGroup } from './tool-groups';
import type { StreamingFlushState } from './flush';
import type { StreamingUIToolRegistryState } from './tool-registry';

export function createStreamingRenderContextState(args: {
  host: StreamingUIHost;
  revealRuntime: StreamingRevealRuntime;
  turnStartCueArmed: boolean;
  currentTurnId: string | undefined;
  currentStep: number;
  streamingBlock: StreamingTextBlock | null;
  activeThinkingComponent: ThinkingComponent | undefined;
  assistantDraft: string;
  thinkingDraft: string;
  activeToolCalls: Map<string, ToolCallBlockData>;
  pendingToolComponents: Map<string, ToolCallComponent>;
  streamingToolCallArguments: Map<string, { name?: string; argumentsText: string; startedAtMs: number }>;
  chainSummary: ChainSummaryState;
  pendingAgentGroup: PendingToolGroup<AgentGroupComponent> | null;
  pendingReadGroup: PendingToolGroup<ReadGroupComponent> | null;
  setStreamingBlock: (block: StreamingTextBlock | null) => void;
  setTurnStartCueArmed: (armed: boolean) => void;
  setActiveThinkingComponent: (component: ThinkingComponent | undefined) => void;
  setPendingAgentGroup: (group: PendingToolGroup<AgentGroupComponent> | null) => void;
  setPendingReadGroup: (group: PendingToolGroup<ReadGroupComponent> | null) => void;
  finalizeLiveTextBuffers: (mode: LivePaneState['mode']) => void;
  onToolCallStart: (toolCall: ToolCallBlockData) => void;
}): StreamingRenderContextState {
  return args;
}

export function createStreamingToolRegistryState(args: {
  host: StreamingUIHost;
  flushState: StreamingFlushState;
  activeToolCalls: Map<string, ToolCallBlockData>;
  pendingToolComponents: Map<string, ToolCallComponent>;
  streamingToolCallArguments: Map<string, { name?: string; argumentsText: string; startedAtMs: number }>;
  finalizeLiveTextBuffers: (mode?: LivePaneState['mode']) => void;
  onToolCallStart: (toolCall: ToolCallBlockData) => void;
  onToolCallEnd: (toolCallId: string, result: import('../../types').ToolResultBlockData) => void;
}): StreamingUIToolRegistryState {
  return args;
}

/** Snapshot surface {@link StreamingUIController} passes for render-context assembly. */
export interface StreamingUIRenderContextHost {
  readonly host: StreamingUIHost;
  readonly revealRuntime: StreamingRevealRuntime;
  readonly turnStartCueArmed: boolean;
  readonly currentTurnId: string | undefined;
  readonly currentStep: number;
  readonly streamingBlock: StreamingTextBlock | null;
  readonly activeThinkingComponent: ThinkingComponent | undefined;
  readonly assistantDraft: string;
  readonly thinkingDraft: string;
  readonly activeToolCalls: Map<string, ToolCallBlockData>;
  readonly pendingToolComponents: Map<string, ToolCallComponent>;
  readonly streamingToolCallArguments: Map<string, { name?: string; argumentsText: string; startedAtMs: number }>;
  readonly chainSummary: ChainSummaryState;
  readonly pendingAgentGroup: PendingToolGroup<AgentGroupComponent> | null;
  readonly pendingReadGroup: PendingToolGroup<ReadGroupComponent> | null;
  setStreamingBlock(block: StreamingTextBlock | null): void;
  setTurnStartCueArmed(armed: boolean): void;
  setActiveThinkingComponent(component: ThinkingComponent | undefined): void;
  setPendingAgentGroup(group: PendingToolGroup<AgentGroupComponent> | null): void;
  setPendingReadGroup(group: PendingToolGroup<ReadGroupComponent> | null): void;
  finalizeLiveTextBuffers(mode: LivePaneState['mode']): void;
  onToolCallStart(toolCall: ToolCallBlockData): void;
}

export interface StreamingUIToolRegistryHost {
  readonly host: StreamingUIHost;
  readonly flushState: StreamingFlushState;
  readonly activeToolCalls: Map<string, ToolCallBlockData>;
  readonly pendingToolComponents: Map<string, ToolCallComponent>;
  readonly streamingToolCallArguments: Map<string, { name?: string; argumentsText: string; startedAtMs: number }>;
  finalizeLiveTextBuffers(mode?: 'assistant' | 'thinking' | 'tool'): void;
  onToolCallStart(toolCall: ToolCallBlockData): void;
  onToolCallEnd(toolCallId: string, result: import('../../types').ToolResultBlockData): void;
}

export function buildStreamingRenderContextStateFromParts(
  parts: Parameters<typeof createStreamingRenderContextState>[0],
): StreamingRenderContextState {
  return createStreamingRenderContextState(parts);
}

export function buildStreamingToolRegistryStateFromParts(
  parts: Parameters<typeof createStreamingToolRegistryState>[0],
): StreamingUIToolRegistryState {
  return createStreamingToolRegistryState(parts);
}

export interface StreamingRenderContextState {
  host: StreamingUIHost;
  revealRuntime: StreamingRevealRuntime;
  turnStartCueArmed: boolean;
  currentTurnId: string | undefined;
  currentStep: number;
  streamingBlock: StreamingTextBlock | null;
  activeThinkingComponent: ThinkingComponent | undefined;
  assistantDraft: string;
  thinkingDraft: string;
  activeToolCalls: Map<string, ToolCallBlockData>;
  pendingToolComponents: Map<string, ToolCallComponent>;
  streamingToolCallArguments: Map<string, { name?: string; argumentsText: string; startedAtMs: number }>;
  chainSummary: ChainSummaryState;
  pendingAgentGroup: PendingToolGroup<AgentGroupComponent> | null;
  pendingReadGroup: PendingToolGroup<ReadGroupComponent> | null;
  setStreamingBlock(block: StreamingTextBlock | null): void;
  setTurnStartCueArmed(armed: boolean): void;
  setActiveThinkingComponent(component: ThinkingComponent | undefined): void;
  setPendingAgentGroup(group: PendingToolGroup<AgentGroupComponent> | null): void;
  setPendingReadGroup(group: PendingToolGroup<ReadGroupComponent> | null): void;
  finalizeLiveTextBuffers(mode: LivePaneState['mode']): void;
  onToolCallStart(toolCall: ToolCallBlockData): void;
}

export function buildTextRenderContext(state: StreamingRenderContextState): TextRenderContext {
  return {
    host: state.host,
    revealRuntime: state.revealRuntime,
    getStreamingBlock: () => state.streamingBlock,
    setStreamingBlock: (block) => {
      state.setStreamingBlock(block);
    },
    getTurnStartCueArmed: () => state.turnStartCueArmed,
    setTurnStartCueArmed: (armed) => {
      state.setTurnStartCueArmed(armed);
    },
    getCurrentTurnId: () => state.currentTurnId,
    getActiveThinkingComponent: () => state.activeThinkingComponent,
    setActiveThinkingComponent: (component) => {
      state.setActiveThinkingComponent(component);
    },
    clearPendingToolGroups: () => {
      state.setPendingAgentGroup(null);
      state.setPendingReadGroup(null);
    },
    settleActiveChainSummary: () => {
      settleActiveChainSummaryHelper(state.chainSummary);
    },
    shouldSmoothStreamReveal: () => shouldSmoothStreamRevealHelper(state.host.state.appState.isReplaying),
    revealContext: () => buildRevealContext(state),
  };
}

export function buildToolRenderContext(state: StreamingRenderContextState): ToolRenderContext {
  return {
    host: state.host,
    getCurrentStep: () => state.currentStep,
    getCurrentTurnId: () => state.currentTurnId,
    getActiveToolCalls: () => state.activeToolCalls,
    getPendingToolComponents: () => state.pendingToolComponents,
    getStreamingToolCallArguments: () => state.streamingToolCallArguments,
    getChainSummary: () => state.chainSummary,
    getPendingAgentGroup: () => state.pendingAgentGroup,
    setPendingAgentGroup: (group) => {
      state.setPendingAgentGroup(group);
    },
    getPendingReadGroup: () => state.pendingReadGroup,
    setPendingReadGroup: (group) => {
      state.setPendingReadGroup(group);
    },
    getThinkingDraftLength: () => state.thinkingDraft.length,
    hasStreamingBlock: () => state.streamingBlock !== null,
    finalizeLiveTextBuffers: (mode) => state.finalizeLiveTextBuffers(mode),
    onToolCallStart: (toolCall) => state.onToolCallStart(toolCall),
  };
}

export function buildRevealContext(state: StreamingRenderContextState): StreamingRevealContext {
  return {
    state: state.host.state,
    isReplaying: state.host.state.appState.isReplaying,
    runtime: state.revealRuntime,
    getStreamingBlock: () => state.streamingBlock,
    getActiveThinkingComponent: () => state.activeThinkingComponent,
  };
}
