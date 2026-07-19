import { SUPERLIORA_CHANGELOG_URL } from './changelog';
import type { GitCheckoutRefreshResult } from './git-checkout';
import { refreshGitCheckoutUpdateTarget } from './git-checkout';
import { emptyUpdateInstallState, readUpdateInstallState } from './install-state';
import { canAutoInstall, installCommandFor } from './preflight';
import { refreshUpdateCache } from './refresh';
import { selectUpdateTarget } from './select';
import { detectInstallSource } from './source';
import {
  type InstallSource,
  type UpdateCache,
  type UpdateInstallState,
} from './types';

export { SUPERLIORA_CHANGELOG_URL };

export type UpgradePlanReason =
  | 'up-to-date'
  | 'update-available'
  | 'diverged'
  | 'unsupported'
  | 'check-failed'
  | 'already-installing';

export interface UpgradePlan {
  readonly source: InstallSource;
  readonly currentVersion: string;
  readonly target: { readonly version: string; readonly upstream?: string } | null;
  readonly installCommand: string;
  readonly changelogUrl: string;
  readonly dirty: boolean;
  readonly canAutoInstall: boolean;
  readonly reason: UpgradePlanReason;
  readonly errorMessage?: string;
}

export interface ResolveUpgradePlanDeps {
  readonly detectInstallSource: () => Promise<InstallSource>;
  readonly refreshGitCheckoutUpdateTarget: () => Promise<GitCheckoutRefreshResult>;
  readonly refreshUpdateCache: () => Promise<UpdateCache>;
  readonly readUpdateInstallState: () => Promise<UpdateInstallState>;
  readonly platform: NodeJS.Platform;
  readonly now?: () => Date;
}

interface BasePlanInput {
  readonly source: InstallSource;
  readonly currentVersion: string;
  readonly target: UpgradePlan['target'];
  readonly reason: UpgradePlanReason;
  readonly dirty: boolean;
  readonly canAutoInstall: boolean;
  readonly platform: NodeJS.Platform;
  readonly errorMessage?: string;
}

function resolveDeps(overrides: Partial<ResolveUpgradePlanDeps>): ResolveUpgradePlanDeps {
  return {
    detectInstallSource: overrides.detectInstallSource ?? (() => detectInstallSource()),
    refreshGitCheckoutUpdateTarget:
      overrides.refreshGitCheckoutUpdateTarget ?? (() => refreshGitCheckoutUpdateTarget()),
    refreshUpdateCache: overrides.refreshUpdateCache ?? (() => refreshUpdateCache()),
    readUpdateInstallState: overrides.readUpdateInstallState ?? (() => readUpdateInstallState()),
    platform: overrides.platform ?? process.platform,
    now: overrides.now ?? (() => new Date()),
  };
}

function basePlan(input: BasePlanInput): UpgradePlan {
  const versionForCommand = input.target?.version ?? input.currentVersion;
  return {
    source: input.source,
    currentVersion: input.currentVersion,
    target: input.target,
    installCommand: installCommandFor(input.source, versionForCommand, input.platform),
    changelogUrl: SUPERLIORA_CHANGELOG_URL,
    dirty: input.dirty,
    canAutoInstall: input.canAutoInstall,
    reason: input.reason,
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  };
}

export async function resolveUpgradePlan(
  currentVersion: string,
  overrides: Partial<ResolveUpgradePlanDeps> = {},
): Promise<UpgradePlan> {
  const deps = resolveDeps(overrides);
  const source = await deps.detectInstallSource().catch(() => 'unsupported' as const);
  const installState = await deps.readUpdateInstallState().catch(() => emptyUpdateInstallState());
  if (installState.active !== null) {
    return basePlan({
      source,
      currentVersion,
      target: { version: installState.active.version },
      reason: 'already-installing',
      dirty: false,
      canAutoInstall: false,
      platform: deps.platform,
    });
  }

  if (source === 'github-checkout') {
    try {
      const result = await deps.refreshGitCheckoutUpdateTarget();
      if (result.status === 'up-to-date') {
        return basePlan({
          source,
          currentVersion,
          target: null,
          reason: 'up-to-date',
          dirty: result.dirty,
          canAutoInstall: false,
          platform: deps.platform,
        });
      }
      if (result.status === 'diverged') {
        return basePlan({
          source,
          currentVersion,
          target: null,
          reason: 'diverged',
          dirty: result.dirty,
          canAutoInstall: false,
          errorMessage: `Git checkout has diverged from ${result.upstream}`,
          platform: deps.platform,
        });
      }
      return basePlan({
        source,
        currentVersion,
        target: { version: result.target.version, upstream: result.target.upstream },
        reason: 'update-available',
        dirty: result.dirty,
        canAutoInstall: canAutoInstall(source, deps.platform) && !result.dirty,
        platform: deps.platform,
      });
    } catch (error) {
      return basePlan({
        source,
        currentVersion,
        target: null,
        reason: 'check-failed',
        dirty: false,
        canAutoInstall: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        platform: deps.platform,
      });
    }
  }

  try {
    const cache = await deps.refreshUpdateCache();
    const target = selectUpdateTarget(currentVersion, cache.latest);
    if (target === null) {
      return basePlan({
        source,
        currentVersion,
        target: null,
        reason: 'up-to-date',
        dirty: false,
        canAutoInstall: false,
        platform: deps.platform,
      });
    }
    return basePlan({
      source,
      currentVersion,
      target,
      reason: 'update-available',
      dirty: false,
      canAutoInstall: canAutoInstall(source, deps.platform),
      platform: deps.platform,
    });
  } catch (error) {
    return basePlan({
      source,
      currentVersion,
      target: null,
      reason: 'check-failed',
      dirty: false,
      canAutoInstall: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      platform: deps.platform,
    });
  }
}
