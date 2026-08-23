/**
 * Turn-status row mouse: `[stop]` cancels, `[↓]` detaches, cue opens /jobs bg.
 * A watcherless parked row has nothing behind the cue — ignore those clicks.
 */

import type { NativeInputEvent } from '#/tui/renderer';

import { getTUIStateNativeActivityRect } from './transcript-hit-test';
import { hasLiveWatchers } from './watchers';
import {
  layoutTurnStatusActionHits,
  resolveTurnStatusActions,
  type TurnStatusPhase,
} from './turn-status';
import { hasDetachableForeground } from '../../utils/foreground-task';
import type { TUIState } from '../../tui-state';
import type { BackgroundTaskInfo } from '@superliora/sdk';

export type ActivityStatusMouseTarget = 'stop' | 'bg' | 'cue';

export interface ActivityCueMouseHost {
  readonly state: TUIState;
  readonly backgroundTasks?: ReadonlyMap<string, BackgroundTaskInfo>;
  readonly shellRunning?: boolean;
  openTasks(): void;
  cancelTurn(): void;
  detachForeground(): void;
}

export function isActivityCueHit(input: {
  readonly event: NativeInputEvent;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined;
  readonly hasWatchers: boolean;
}): boolean {
  return resolveActivityStatusMouseTarget({ ...input, showStop: false, showBg: false }) === 'cue';
}

export function resolveActivityStatusMouseTarget(input: {
  readonly event: NativeInputEvent;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined;
  readonly hasWatchers: boolean;
  readonly showStop?: boolean;
  readonly showBg?: boolean;
}): ActivityStatusMouseTarget | undefined {
  if (input.event.type !== 'mouse' || input.event.action !== 'press') return undefined;
  if (input.event.button !== undefined && input.event.button !== 'left') return undefined;
  const rect = input.rect;
  if (rect === undefined || rect.height <= 0) return undefined;
  if (
    input.event.y < rect.y ||
    input.event.y >= rect.y + rect.height ||
    input.event.x < rect.x ||
    input.event.x >= rect.x + rect.width
  ) {
    return undefined;
  }
  const localX = input.event.x - rect.x;
  const hits = layoutTurnStatusActionHits({
    rowWidth: rect.width,
    showStop: input.showStop === true,
    showBg: input.showBg === true,
  });
  if (hits.stop !== undefined && localX >= hits.stop.start && localX < hits.stop.end) {
    return 'stop';
  }
  if (hits.bg !== undefined && localX >= hits.bg.start && localX < hits.bg.end) {
    return 'bg';
  }
  return input.hasWatchers ? 'cue' : undefined;
}

export function resolveActivityStatusActions(input: {
  readonly streamingPhase: string;
  readonly parked?: boolean;
  readonly hasForegroundTask: boolean;
}): { readonly showStop: boolean; readonly showBg: boolean; readonly phase: TurnStatusPhase } {
  const parked = input.parked === true;
  const streaming = input.streamingPhase !== 'idle';
  const phase: TurnStatusPhase = parked || !streaming ? 'watching' : 'tool';
  return {
    ...resolveTurnStatusActions({
      phase,
      parked,
      showStop: streaming && !parked,
      showBg: streaming && !parked && input.hasForegroundTask,
    }),
    phase,
  };
}

export function handleActivityCueMouse(
  host: ActivityCueMouseHost,
  event: NativeInputEvent,
): boolean {
  const tasks = host.backgroundTasks;
  const actions = resolveActivityStatusActions({
    streamingPhase: host.state.appState.streamingPhase,
    parked: host.state.turnActivity?.parked === true,
    hasForegroundTask: hasDetachableForeground(tasks?.values(), host.shellRunning === true),
  });
  const target = resolveActivityStatusMouseTarget({
    event,
    rect: getTUIStateNativeActivityRect(host.state),
    hasWatchers: hasLiveWatchers(tasks),
    showStop: actions.showStop,
    showBg: actions.showBg,
  });
  if (target === 'stop') {
    host.cancelTurn();
    return true;
  }
  if (target === 'bg') {
    host.detachForeground();
    return true;
  }
  if (target === 'cue') {
    host.openTasks();
    return true;
  }
  return false;
}
