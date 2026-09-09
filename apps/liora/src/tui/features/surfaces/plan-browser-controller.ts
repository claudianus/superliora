/**
 * Plan-browser open helpers.
 *
 * Homepage demo: pressing P reveals a Plan overlay and pressing P again (or
 * Esc) hides it. In the real TUI, plan mode is a behavioural mode (not just a
 * panel), so the browser is a *companion* view of the active plan file:
 *
 *  - Entering plan mode (inline) mounts the browser with the current plan.
 *  - Pressing P while the browser is open closes it (mode stays on).
 *  - Turning plan mode off (`/plan` off) closes the browser.
 *
 * Plan mode itself is toggled through `/plan` / Command Hub; `P` opens the
 * browser and, when plan mode is off, first switches it on via `/plan`.
 */

import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { PlanBrowserOverlayComponent } from './plan-browser';
import {
  rememberOpenSurface,
  SURFACE_PLAN,
} from './editor-surface-toggle';

/** Mount a read-only Plan browser over the editor area. */
export function mountPlanBrowser(
  host: SlashCommandHost,
  content: string,
  planPath?: string,
): void {
  const panel = new PlanBrowserOverlayComponent({
    content,
    path: planPath,
    onClose: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(panel);
  rememberOpenSurface(SURFACE_PLAN, panel);
  requestTUILayoutRender(host.state);
}

/**
 * Open the browser from the session's current plan (used when plan mode is
 * already active). Shows a gentle status if no plan file has been written yet.
 */
export async function openPlanBrowserFromCurrentPlan(
  host: SlashCommandHost,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }
  const plan = await session.getPlan().catch(() => null);
  if (plan !== null && plan.content.trim().length > 0) {
    mountPlanBrowser(host, plan.content, plan.path);
    return;
  }
  host.showStatus(
    'Plan mode is on but no plan has been drafted yet — start a planning turn or edit the plan file.',
    'textMuted',
  );
}
