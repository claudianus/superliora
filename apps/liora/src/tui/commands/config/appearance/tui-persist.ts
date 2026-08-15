/**
 * Shared helpers for persisting TUI preferences from slash-command host state.
 */

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_CONDUCTOR_PREFERENCES,
  DEFAULT_FOOTER_PREFERENCES,
  DEFAULT_LOCALE_PREFERENCE,
  DEFAULT_ONBOARDING_PREFERENCES,
  DEFAULT_PERFORMANCE_MODE,
  type AppearancePreferences,
  type ConductorPreferences,
  type FooterPreferences,
  type LocalePreference,
  type OnboardingPreferences,
  type PerformanceMode,
  type TuiConfig,
} from '../../../config';
import type { SlashCommandHost } from '../../hub/dispatch';

export function currentAppearance(host: {
  readonly state: { readonly appState: { readonly appearance?: AppearancePreferences } };
}): AppearancePreferences {
  return host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
}

export function currentPerformanceMode(host: {
  readonly state: { readonly appState: { readonly performanceMode?: PerformanceMode } };
}): PerformanceMode {
  return host.state.appState.performanceMode ?? DEFAULT_PERFORMANCE_MODE;
}

export function currentFooter(host: {
  readonly state: { readonly appState: { readonly footer?: FooterPreferences } };
}): FooterPreferences {
  return host.state.appState.footer ?? DEFAULT_FOOTER_PREFERENCES;
}

export function currentConductor(host: {
  readonly state: { readonly appState: { readonly conductor?: ConductorPreferences } };
}): ConductorPreferences {
  return host.state.appState.conductor ?? DEFAULT_CONDUCTOR_PREFERENCES;
}

export function tuiConfigFromHost(
  host: {
    readonly state: {
      readonly appState: Pick<
        SlashCommandHost['state']['appState'],
        | 'theme'
        | 'editorCommand'
        | 'notifications'
        | 'upgrade'
        | 'disablePasteBurst'
        | 'permissionMode'
        | 'locale'
        | 'performanceMode'
      > & {
        readonly appearance?: AppearancePreferences;
        readonly footer?: FooterPreferences;
        readonly onboarding?: OnboardingPreferences;
        readonly conductor?: ConductorPreferences;
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
    footer: currentFooter(host),
    onboarding: host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES,
    conductor: currentConductor(host),
    locale: host.state.appState.locale ?? DEFAULT_LOCALE_PREFERENCE,
    performanceMode: currentPerformanceMode(host),
    ...patch,
  };
}
