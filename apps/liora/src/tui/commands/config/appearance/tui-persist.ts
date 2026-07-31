/**
 * Shared helpers for persisting TUI preferences from slash-command host state.
 */

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  type AppearancePreferences,
  type OnboardingPreferences,
  type TuiConfig,
} from '../../../config';
import type { SlashCommandHost } from '../../hub/dispatch';

export function currentAppearance(host: {
  readonly state: { readonly appState: { readonly appearance?: AppearancePreferences } };
}): AppearancePreferences {
  return host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
}

export function tuiConfigFromHost(
  host: {
    readonly state: {
      readonly appState: Pick<
        SlashCommandHost['state']['appState'],
        'theme' | 'editorCommand' | 'notifications' | 'upgrade' | 'disablePasteBurst' | 'permissionMode'
      > & {
        readonly appearance?: AppearancePreferences;
        readonly onboarding?: OnboardingPreferences;
      };
    };
  },
  patch: Partial<TuiConfig> = {},
): TuiConfig {
  return {
    theme: host.state.appState.theme,
    permissionMode: host.state.appState.permissionMode,
    disablePasteBurst: host.state.appState.disablePasteBurst ?? false,
    editorCommand: host.state.appState.editorCommand,
    notifications: host.state.appState.notifications,
    upgrade: host.state.appState.upgrade,
    appearance: currentAppearance(host),
    onboarding: host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES,
    ...patch,
  };
}
