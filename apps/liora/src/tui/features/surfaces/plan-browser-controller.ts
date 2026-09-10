/**
 * Plan-browser open helpers.
 *
 * Homepage demo: pressing P reveals a Plan overlay and pressing P again (or
 * Esc) hides it. In the real TUI, plan mode is a behavioural mode (not just a
 * panel), so the browser is a *companion* view of the active plan file.
 *
 * `/plan` (and Command Hub) toggle plan mode and announce it. The `P` shortcut
 * is mode-aware: pressing P while plan mode is on opens (or reopens) the plan
 * browser; pressing P while it is off first switches plan mode on and then, if
 * planning landed inline with a plan already written, shows that plan. Turning
 * plan mode off closes the browser.
 */

import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { resolvePlanActivation } from '#/tui/utils/plan-activation';
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

function hasPlanContent(
  plan: { readonly content: string; readonly path: string } | null | undefined,
): plan is { readonly content: string; readonly path: string } {
  return plan !== null && plan !== undefined && typeof plan.content === 'string' && plan.content.trim().length > 0;
}

/**
 * Open the browser from the session's current plan. Shows a gentle status if
 * plan mode is on but no plan file has been written yet.
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
  if (hasPlanContent(plan)) {
    mountPlanBrowser(host, plan.content, plan.path);
    return;
  }
  host.showStatus(
    'Plan mode is on but no plan has been drafted yet — start a planning turn or edit the plan file.',
    'textMuted',
  );
}

/**
 * `P` shortcut entry. When plan mode is already active, just show the plan.
 * When it is off, switch it on first (mirroring the bare `/plan` activation
 * logic incl. inline/delegated/unknown) and then surface the plan if planning
 * landed inline with content already present.
 */
export async function openPlanBrowserForUser(
  host: SlashCommandHost,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }
  if (host.state.appState.planMode !== true) {
    try {
      await session.setPlanMode(true, false);
    } catch (error) {
      host.showError(formatErrorMessage(error));
      return;
    }
    const activation = await resolvePlanActivation(session);
    host.setAppState({
      planMode: activation !== 'delegated',
      activityTip:
        activation === 'delegated'
          ? 'Plan Desk: planning Job accepted — watch Job strip / inbox'
          : null,
    });
    if (activation === 'delegated') {
      host.showNotice(
        'Plan Desk: planning delegated to a Job',
        'Conductor stays free — plan worker runs research/interview. Check Job strip / JobInbox.',
      );
      return;
    }
    if (activation === 'unknown') {
      host.showNotice(
        'Plan mode requested',
        'Could not read session status — check the footer or /status for where planning landed.',
      );
      return;
    }
  }
  await openPlanBrowserFromCurrentPlan(host);
}
