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

export function isManagedUsageProvider(
  providerKey: string | undefined,
): providerKey is typeof DEFAULT_OAUTH_PROVIDER_NAME {
  return providerKey === DEFAULT_OAUTH_PROVIDER_NAME;
}
