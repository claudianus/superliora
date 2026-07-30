import {
  ABORTED_LABEL,
  CANCELLED_LABEL,
  cancelledLabelColor,
  isCodeWriteToolActivity,
  normalizeFinalOutputText,
  runningCellLabelText,
} from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import { normalizeFailureText } from '#/tui/features/agent-swarm/agent-swarm-result-parser';
import type { ColorPalette } from '#/tui/theme/colors';
import type {
  AgentSwarmMember,
  AgentSwarmPhase,
} from '#/tui/features/agent-swarm/agent-swarm-progress-types';

type ClearableMemberKey =
  | 'completedAtMs'
  | 'completedText'
  | 'failedAtMs'
  | 'failureText'
  | 'cancelledLabelText'
  | 'cancelledLabelColor'
  | 'cancelledMarkColor'
  | 'cancelledBarColor'
  | 'suspendedReason'
  | 'activeToolName'
  | 'codeWriteAtMs'
  | 'retryNote';

export const COMPLETED_CLEAR_KEYS = [
  'failedAtMs',
  'failureText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
  'retryNote',
] as const satisfies readonly ClearableMemberKey[];

export const FAILED_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
] as const satisfies readonly ClearableMemberKey[];

export const TERMINAL_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'failedAtMs',
  'failureText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
  'retryNote',
] as const satisfies readonly ClearableMemberKey[];

export const CANCELLED_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'failedAtMs',
  'failureText',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
  'retryNote',
] as const satisfies readonly ClearableMemberKey[];

export function createAgentSwarmMembers(
  count: number,
  phase: AgentSwarmPhase,
): AgentSwarmMember[] {
  return Array.from({ length: count }, (_item, index) => ({
    id: String(index + 1).padStart(3, '0'),
    phase,
    ticks: 0,
    itemText: '',
    latestModelText: '',
    todos: [],
  }));
}

export function clearAgentSwarmMemberState(
  member: AgentSwarmMember,
  ...keys: readonly ClearableMemberKey[]
): void {
  for (const key of keys) delete member[key];
}

export function terminalPhaseElapsedMs(member: AgentSwarmMember, nowMs: number): number {
  const startedAtMs = member.phase === 'completed'
    ? member.completedAtMs
    : member.phase === 'failed'
      ? member.failedAtMs
      : undefined;
  return startedAtMs === undefined ? 0 : Math.max(0, nowMs - startedAtMs);
}

export function updateAgentSwarmMemberItemTexts(
  members: readonly AgentSwarmMember[],
  fullItems: readonly string[],
  partialItems: readonly string[],
): void {
  const count = Math.max(fullItems.length, partialItems.length, members.length);
  for (let index = 0; index < count; index += 1) {
    const member = members[index];
    if (member === undefined) continue;
    const itemText = fullItems[index] ?? partialItems[index];
    if (itemText !== undefined) member.itemText = itemText;
  }
}

export function trackAgentSwarmMemberCodeWriteActivity(
  member: AgentSwarmMember,
  input: {
    readonly body: string;
    readonly isError?: boolean;
    readonly toolName?: string;
  },
  nowMs: number,
): void {
  if (input.isError !== true && isCodeWriteToolActivity(input.toolName, input.body)) {
    member.codeWriteAtMs = nowMs;
  } else {
    delete member.codeWriteAtMs;
  }
}

export function promoteAgentSwarmMemberToRunning(
  member: AgentSwarmMember,
  input: {
    readonly nowMs?: number;
    readonly setTicks?: boolean;
    readonly onStarted?: (memberId: string, nowMs: number) => void;
    readonly onSwarmStarted?: (nowMs: number) => void;
  } = {},
): void {
  if (member.phase === 'pending' || member.phase === 'queued' || member.phase === 'suspended') {
    member.phase = 'running';
    const nowMs = input.nowMs ?? Date.now();
    member.startedAtMs ??= nowMs;
    if (input.nowMs !== undefined) {
      input.onSwarmStarted?.(input.nowMs);
      input.onStarted?.(member.id, input.nowMs);
    }
    if (input.setTicks === true) member.ticks = Math.max(member.ticks, 1);
  }
  delete member.suspendedReason;
}

export function applyAgentSwarmMemberCompleted(
  member: AgentSwarmMember,
  nowMs: number,
  completedText: string | undefined,
  onFirstComplete: () => void,
): void {
  if (member.phase !== 'completed') {
    onFirstComplete();
    member.completedAtMs = nowMs;
  }
  const normalizedCompletedText = normalizeFinalOutputText(completedText);
  if (normalizedCompletedText !== undefined) member.completedText = normalizedCompletedText;
  member.phase = 'completed';
  clearAgentSwarmMemberState(member, ...COMPLETED_CLEAR_KEYS);
}

export function applyAgentSwarmMemberFailed(
  member: AgentSwarmMember,
  nowMs: number,
  failureText: string | undefined,
  onFirstFailed: () => void,
  retryNote?: string,
): void {
  if (member.phase !== 'failed') {
    onFirstFailed();
    member.failedAtMs = nowMs;
  }
  const normalizedFailureText = normalizeFailureText(failureText);
  if (normalizedFailureText !== undefined) member.failureText = normalizedFailureText;
  const normalizedRetryNote = normalizeFailureText(retryNote);
  if (normalizedRetryNote !== undefined) member.retryNote = normalizedRetryNote;
  member.phase = 'failed';
  clearAgentSwarmMemberState(member, ...FAILED_CLEAR_KEYS);
}

export function applyAgentSwarmMemberCancelled(
  member: AgentSwarmMember,
  colors: ColorPalette,
  onCancelled: () => void,
): void {
  const previousPhase = member.phase;
  onCancelled();
  member.phase = 'cancelled';
  clearAgentSwarmMemberState(member, ...CANCELLED_CLEAR_KEYS);
  if (previousPhase === 'pending' || previousPhase === 'queued' || previousPhase === 'suspended') {
    member.cancelledLabelText = CANCELLED_LABEL;
    member.cancelledLabelColor = cancelledLabelColor(colors);
    member.cancelledMarkColor = colors.warning;
    member.cancelledBarColor = colors.warning;
  } else if (previousPhase === 'running') {
    member.cancelledLabelText = runningCellLabelText(member);
    member.cancelledLabelColor = cancelledLabelColor(colors);
    member.cancelledMarkColor = colors.warning;
    member.cancelledBarColor = colors.warning;
  } else {
    member.cancelledLabelText = ABORTED_LABEL;
    member.cancelledLabelColor = colors.warning;
    member.cancelledMarkColor = colors.warning;
    member.cancelledBarColor = colors.warning;
  }
}

export function findAgentSwarmMemberByAgentId(
  members: readonly AgentSwarmMember[],
  agentId: string,
): AgentSwarmMember | undefined {
  return members.find((member) => member.agentId === agentId);
}

export function resolveAgentSwarmMemberForSubagent(
  getMembers: () => readonly AgentSwarmMember[],
  agentId: string,
  swarmIndex: number | undefined,
  ensureMemberCount: (count: number) => void,
): AgentSwarmMember | undefined {
  const existing = findAgentSwarmMemberByAgentId(getMembers(), agentId);
  if (existing !== undefined) return existing;

  if (swarmIndex !== undefined && Number.isInteger(swarmIndex) && swarmIndex > 0) {
    ensureMemberCount(swarmIndex);
    const byIndex = getMembers()[swarmIndex - 1];
    if (byIndex !== undefined) return byIndex;
  }

  const members = getMembers();
  const unassigned = members.find((member) => member.agentId === undefined);
  if (unassigned !== undefined) return unassigned;

  ensureMemberCount(members.length + 1);
  return getMembers().at(-1);
}
