import type { Component } from '../../renderer';
import { AssistantMessageComponent } from '../../components/messages/assistant-message';
import { PluginCommandComponent } from '../../components/messages/plugin-command';
import { StepSummaryComponent } from '../../components/messages/step-summary';
import { ThinkingComponent } from '../../components/messages/thinking';
import { ToolCallComponent } from '../../components/messages/tool-call/index';
import { UserMessageComponent } from '../../components/messages/user-message';
import { WelcomeComponent } from '../../components/chrome/welcome';
import {
  TRANSCRIPT_HYSTERESIS,
  TRANSCRIPT_KEEP_RECENT_STEPS,
  TRANSCRIPT_MAX_TURNS,
  TRANSCRIPT_WINDOW_ENABLED,
  groupTurns,
  turnsToTrim,
} from '../../features/transcript/transcript-window';
import { getTranscriptComponentEntry } from '../../features/transcript/transcript-component-metadata';
import { hasDispose } from '../../utils/component-capabilities';
import { requestTUIContentRender } from '../../utils/render/frame-render';
import type { TranscriptRenderHost } from './transcript-render';

export function isTurnBoundaryComponent(child: Component): boolean {
  if (!(child instanceof UserMessageComponent) && !(child instanceof PluginCommandComponent)) {
    return false;
  }
  const entry = getTranscriptComponentEntry(child);
  if (entry === undefined) return false;
  return entry.turnId === undefined || entry.turnId.startsWith('replay:');
}

export function trimTranscriptWindow(host: TranscriptRenderHost): boolean {
  if (!TRANSCRIPT_WINDOW_ENABLED || TRANSCRIPT_MAX_TURNS <= 0) return false;
  if (host.state.appState.isReplaying) return false;

  const children = host.state.transcriptContainer.children;
  const boundaries: number[] = [];
  for (let i = 0; i < children.length; i++) {
    if (isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
  }

  const turns = groupTurns(host.state.transcriptEntries);
  const toRemove = turnsToTrim(turns, TRANSCRIPT_MAX_TURNS, TRANSCRIPT_HYSTERESIS);
  if (toRemove.size === 0) return false;

  let boundariesToRemove = 0;
  for (const entry of toRemove) {
    if (entry.kind === 'user' && entry.turnId === undefined) boundariesToRemove++;
  }
  if (boundariesToRemove === 0) {
    host.state.transcriptEntries = host.state.transcriptEntries.filter((e) => !toRemove.has(e));
    return true;
  }

  let boundariesSeen = 0;
  let cutoff = 0;
  for (let i = 0; i < children.length; i++) {
    if (isTurnBoundaryComponent(children[i]!)) {
      if (boundariesSeen === boundariesToRemove) {
        cutoff = i;
        break;
      }
      boundariesSeen++;
    }
  }

  const componentsToRemove: Component[] = [];
  for (let i = 0; i < cutoff; i++) {
    const child = children[i]!;
    if (child instanceof WelcomeComponent) continue;
    componentsToRemove.push(child);
  }
  for (const child of componentsToRemove) {
    host.state.transcriptContainer.removeChild(child);
    if (hasDispose(child)) child.dispose();
  }

  host.state.transcriptEntries = host.state.transcriptEntries.filter((e) => !toRemove.has(e));
  return true;
}

export function mergeCurrentTurnSteps(host: TranscriptRenderHost): boolean {
  if (TRANSCRIPT_KEEP_RECENT_STEPS <= 0) return false;
  const children = host.state.transcriptContainer.children;

  let turnStart = -1;
  for (let i = children.length - 1; i >= 0; i--) {
    if (isTurnBoundaryComponent(children[i]!)) {
      turnStart = i;
      break;
    }
  }
  if (turnStart < 0) return false;

  let summaryIndex = -1;
  const stepIndices: number[] = [];
  for (let i = turnStart + 1; i < children.length; i++) {
    const child = children[i]!;
    if (child instanceof StepSummaryComponent) {
      summaryIndex = i;
      continue;
    }
    if (child instanceof AssistantMessageComponent) continue;
    stepIndices.push(i);
  }

  const mergeThreshold = host.state.appState.isReplaying
    ? TRANSCRIPT_KEEP_RECENT_STEPS + Math.max(TRANSCRIPT_KEEP_RECENT_STEPS, 20)
    : TRANSCRIPT_KEEP_RECENT_STEPS;
  if (stepIndices.length <= mergeThreshold) return false;
  const mergeCount = stepIndices.length - TRANSCRIPT_KEEP_RECENT_STEPS;
  const toMergeIndices = stepIndices.slice(0, mergeCount);

  let thinkingCount = 0;
  let toolCount = 0;
  for (const idx of toMergeIndices) {
    const child = children[idx]!;
    if (child instanceof ThinkingComponent) thinkingCount++;
    else if (child instanceof ToolCallComponent) toolCount++;
  }
  if (thinkingCount === 0 && toolCount === 0) return false;

  let summary: StepSummaryComponent;
  if (summaryIndex >= 0) {
    summary = children[summaryIndex] as StepSummaryComponent;
    summary.addCounts(thinkingCount, toolCount);
  } else {
    summary = new StepSummaryComponent();
    summary.addCounts(thinkingCount, toolCount);
  }

  const toMergeSet = new Set(toMergeIndices);
  const newChildren: Component[] = [];
  for (let i = 0; i <= turnStart; i++) newChildren.push(children[i]!);
  newChildren.push(summary);
  for (let i = turnStart + 1; i < children.length; i++) {
    if (i === summaryIndex) continue;
    if (toMergeSet.has(i)) continue;
    newChildren.push(children[i]!);
  }

  for (const idx of toMergeIndices) {
    const child = children[idx]!;
    if (hasDispose(child)) child.dispose();
  }

  children.splice(0, children.length, ...newChildren);
  return true;
}

export function mergeAllTurnSteps(host: TranscriptRenderHost): void {
  if (TRANSCRIPT_KEEP_RECENT_STEPS <= 0) return;
  const children = host.state.transcriptContainer.children;

  const boundaries: number[] = [];
  for (let i = 0; i < children.length; i++) {
    if (isTurnBoundaryComponent(children[i]!)) boundaries.push(i);
  }
  if (boundaries.length === 0) return;

  const newChildren: Component[] = [];
  const toDispose: Component[] = [];
  for (let i = 0; i < boundaries[0]!; i++) newChildren.push(children[i]!);

  for (let t = 0; t < boundaries.length; t++) {
    const turnStart = boundaries[t]!;
    const turnEnd = t + 1 < boundaries.length ? boundaries[t + 1]! : children.length;
    newChildren.push(children[turnStart]!);

    let summaryIndex = -1;
    const stepIndices: number[] = [];
    for (let i = turnStart + 1; i < turnEnd; i++) {
      const child = children[i]!;
      if (child instanceof StepSummaryComponent) summaryIndex = i;
      else if (child instanceof AssistantMessageComponent) continue;
      else stepIndices.push(i);
    }

    if (stepIndices.length > TRANSCRIPT_KEEP_RECENT_STEPS) {
      const mergeCount = stepIndices.length - TRANSCRIPT_KEEP_RECENT_STEPS;
      const toMergeIndices = stepIndices.slice(0, mergeCount);
      let thinkingCount = 0;
      let toolCount = 0;
      for (const idx of toMergeIndices) {
        const child = children[idx]!;
        if (child instanceof ThinkingComponent) thinkingCount++;
        else if (child instanceof ToolCallComponent) toolCount++;
      }
      let summary: StepSummaryComponent;
      if (summaryIndex >= 0) {
        summary = children[summaryIndex] as StepSummaryComponent;
        summary.addCounts(thinkingCount, toolCount);
      } else {
        summary = new StepSummaryComponent();
        summary.addCounts(thinkingCount, toolCount);
      }
      newChildren.push(summary);
      for (const idx of toMergeIndices) toDispose.push(children[idx]!);
      const toMergeSet = new Set(toMergeIndices);
      for (let i = turnStart + 1; i < turnEnd; i++) {
        if (i === summaryIndex) continue;
        if (toMergeSet.has(i)) continue;
        newChildren.push(children[i]!);
      }
    } else {
      for (let i = turnStart + 1; i < turnEnd; i++) newChildren.push(children[i]!);
    }
  }

  for (const child of toDispose) {
    if (hasDispose(child)) child.dispose();
  }
  children.splice(0, children.length, ...newChildren);
}

export function runTranscriptWindowMaintenance(host: TranscriptRenderHost): void {
  if (host.state.appState.isReplaying) {
    mergeCurrentTurnSteps(host);
    return;
  }
  const trimmed = trimTranscriptWindow(host);
  const merged = mergeCurrentTurnSteps(host);
  if (trimmed || merged) {
    requestTUIContentRender(host.state);
  }
}
