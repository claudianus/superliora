import type { PermissionMode } from '@superliora/sdk';

import type { CLIOptions } from '#/cli/options';

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_FOOTER_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  type TuiConfig,
} from '../config';
import type { AppState } from '../types';

/** Inputs required to seed {@link AppState} before the TUI mounts. */
export interface InitialAppStateInput {
  readonly cliOptions: CLIOptions;
  readonly additionalDirs?: readonly string[];
  readonly tuiConfig: TuiConfig;
  readonly version: string;
  readonly workDir: string;
  readonly updateNotice?: {
    readonly currentVersion: string;
    readonly targetVersion: string;
    readonly installCommand: string;
  };
  readonly updateLifecycle?: AppState['updateLifecycle'];
}

export function createInitialAppState(input: InitialAppStateInput): AppState {
  // Restore persisted permission mode; --auto CLI flag overrides.
  const startupPermission: PermissionMode = input.cliOptions.auto
    ? 'auto'
    : input.tuiConfig.permissionMode;
  return {
    model: '',
    workDir: input.workDir,
    additionalDirs: [...(input.additionalDirs ?? [])],
    sessionId: '',
    permissionMode: startupPermission,
    inputMode: 'prompt',
    thinking: false,
    thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    activityTip: null,
    theme: input.tuiConfig.theme,
    locale: input.tuiConfig.locale,
    performanceMode: input.tuiConfig.performanceMode,
    disablePasteBurst: input.tuiConfig.disablePasteBurst,
    version: input.version,
    editorCommand: input.tuiConfig.editorCommand,
    notifications: input.tuiConfig.notifications,
    upgrade: input.tuiConfig.upgrade,
    appearance: input.tuiConfig.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
    footer: input.tuiConfig.footer ?? DEFAULT_FOOTER_PREFERENCES,
    onboarding: input.tuiConfig.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES,
    transcriptRegionMode: 'chat',
    availableModels: {},
    availableProviders: {},
    providerRouteStatus: null,
    lastProviderRouteSelection: null,
    lastModelRouteNotice: null,
    sessionTitle: null,
    providerQuota: null,
    banner: undefined,
    updateNotice: input.updateNotice ?? null,
    updateLifecycle: input.updateLifecycle ?? null,
  };
}
