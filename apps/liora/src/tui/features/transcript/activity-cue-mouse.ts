/**
 * Click the still-running / parked turn-status cue to open /tasks.
 * A watcherless parked row has nothing behind it — ignore those clicks.
 */

import type { NativeInputEvent } from '#/tui/renderer';

import { getTUIStateNativeActivityRect } from './transcript-hit-test';
import { hasLiveWatchers } from './watchers';
import type { TUIState } from '../../tui-state';
import type { BackgroundTaskInfo } from '@superliora/sdk';

export interface ActivityCueMouseHost {
  readonly state: TUIState;
  readonly backgroundTasks?: ReadonlyMap<string, BackgroundTaskInfo>;
  openTasks(): void;
}

export function isActivityCueHit(input: {
  readonly event: NativeInputEvent;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined;
  readonly hasWatchers: boolean;
}): boolean {
  if (input.event.type !== 'mouse' || input.event.action !== 'press') return false;
  if (input.event.button !== undefined && input.event.button !== 'left') return false;
  if (!input.hasWatchers) return false;
  const rect = input.rect;
  if (rect === undefined || rect.height <= 0) return false;
  return (
    input.event.y >= rect.y &&
    input.event.y < rect.y + rect.height &&
    input.event.x >= rect.x &&
    input.event.x < rect.x + rect.width
  );
}

export function handleActivityCueMouse(
  host: ActivityCueMouseHost,
  event: NativeInputEvent,
): boolean {
  if (
    !isActivityCueHit({
      event,
      rect: getTUIStateNativeActivityRect(host.state),
      hasWatchers: hasLiveWatchers(host.backgroundTasks),
    })
  ) {
    return false;
  }
  host.openTasks();
  return true;
}
