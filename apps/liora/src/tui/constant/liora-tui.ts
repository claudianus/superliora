import { DEFAULT_OAUTH_PROVIDER_NAME } from '#/constant/app';
import { shortcutHint } from '#/tui/utils/os-shortcuts';
import { ttui } from '#/tui/utils/tui-i18n';

export { DEFAULT_OAUTH_PROVIDER_NAME, OAUTH_LOGIN_REQUIRED_CODE, PRODUCT_NAME } from '#/constant/app';

/** Localized at call time so locale switches apply without restart. */
export function LLM_NOT_SET_MESSAGE(): string {
  return ttui('tui.status.llmNotSet');
}

export function NO_ACTIVE_SESSION_MESSAGE(): string {
  return ttui('tui.status.noActiveSession');
}

export function CTRL_D_HINT(): string {
  return shortcutHint('tui.footer.exitConfirmPrimaryD');
}

export function CTRL_C_HINT(): string {
  return shortcutHint('tui.footer.exitConfirmPrimaryC');
}

export function OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE(): string {
  return ttui('tui.status.oauthLoginRequired');
}

export const MAIN_AGENT_ID = 'main';
export const EXIT_CONFIRM_WINDOW_MS = 1500;
export const DOUBLE_ESC_WINDOW_MS = 600;
/**
 * Paste payloads past this size get a confirm toast instead of inserting
 * silently: a 50k-line log paste used to freeze the editor layout pass and
 * could be sent to the model (billed tokens) with one Enter.
 */
export const LARGE_PASTE_WARN_CHARS = 12_000;
/** Confirm window for the large-paste toast; re-paste/Enter after it is a deliberate send. */
export const LARGE_PASTE_CONFIRM_WINDOW_MS = 4000;

export function isManagedUsageProvider(
  providerKey: string | undefined,
): providerKey is typeof DEFAULT_OAUTH_PROVIDER_NAME {
  return providerKey === DEFAULT_OAUTH_PROVIDER_NAME;
}
