/**
 * Worker Dock mouse routing: hover highlight + click-to-open transcript.
 * Hit-tests against the mission band rect and the panel's last painted
 * worker-row map (content-local rows → workerId).
 */

import type { NativeInputEvent, NativeInputMouseEvent } from '#/tui/renderer';

import type { TUIState } from '#/tui/tui-state';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import { getTUIStateNativeMissionRect } from '#/tui/features/transcript/transcript-hit-test';
import { requestTUIContentRender } from '#/tui/utils/render/frame-render';
import {
  chromeHeaderHoverId,
  clearHoverRegion,
  getHoverRegionId,
  missionWorkerHoverId,
  setHoverRegion,
} from './worker-hover';

export interface WorkerDockMouseHost {
  readonly state: TUIState;
  openWorkerTranscript?(workerId: string): void;
}

/**
 * Global mouse handler for the Mission Control / Worker Dock band.
 * Returns true when the event was consumed (click open).
 * Hover moves never consume — they only update paint state.
 */
export function handleWorkerDockMouse(
  host: WorkerDockMouseHost,
  event: NativeInputEvent,
): boolean {
  if (event.type !== 'mouse') return false;
  const mouse = event;
  const rect = getTUIStateNativeMissionRect(host.state);
  if (rect === undefined) {
    if (mouse.action === 'move' || mouse.action === 'drag') {
      if (clearHoverIfDock()) requestTUIContentRender(host.state);
    }
    return false;
  }

  const inside =
    mouse.x >= rect.x &&
    mouse.x < rect.x + rect.width &&
    mouse.y >= rect.y &&
    mouse.y < rect.y + rect.height;

  if (!inside) {
    if (mouse.action === 'move' || mouse.action === 'drag') {
      if (clearHoverIfDock()) requestTUIContentRender(host.state);
    }
    return false;
  }

  const panel = host.state.missionControlPanel;
  const localY = mouse.y - rect.y;
  // Rounded panel: top border + optional title. Worker rows are reported
  // relative to content interior (panel maps them).
  const hit = panel.hitTestWorkerRow(localY, rect.height);

  if (mouse.action === 'move' || mouse.action === 'drag') {
    const now = appearanceAnimationNow();
    let region: string | undefined;
    if (hit?.kind === 'worker') {
      region = missionWorkerHoverId(hit.workerId);
    } else if (hit?.kind === 'header') {
      region = chromeHeaderHoverId('mission');
    }
    if (setHoverRegion(region, now)) {
      requestTUIContentRender(host.state);
    }
    return false;
  }

  if (mouse.action !== 'press' || mouse.button !== 'left') return false;
  if (hit?.kind !== 'worker') return false;

  // Select + open on click.
  panel.selectWorker(hit.workerId);
  host.openWorkerTranscript?.(hit.workerId);
  requestTUIContentRender(host.state);
  return true;
}

function clearHoverIfDock(): boolean {
  // Leave tool-output / resize hover alone when our region is not active.
  const id = getHoverRegionId();
  if (id === undefined) return false;
  if (!id.startsWith('mc:worker:') && !id.startsWith('chrome:hdr:mission')) {
    return false;
  }
  return clearHoverRegion();
}

/** Test helper: resolve a content-local row index from a mouse event. */
export function missionLocalRow(
  event: NativeInputMouseEvent,
  rectY: number,
): number {
  return event.y - rectY;
}
