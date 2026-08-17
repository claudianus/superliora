import { homedir } from 'node:os';
import { join } from 'node:path';

import { SUPERLIORA_CHANGELOG_URL } from './changelog';
import type { GitCheckoutRefreshResult, GitCheckoutUpdateOptions } from './git-checkout';
import {
  detectSuperLioraGithubCheckout,
  findGitCheckoutRoot,
  gitCheckoutVersionLabel,
  refreshGitCheckoutUpdateTarget,
} from './git-checkout';
import { hasLiveActiveInstall } from './install-runtime';
import { emptyUpdateInstallState, readUpdateInstallState, writeUpdateInstallState } from './install-state';
import { canAutoInstall, installCommandFor } from './preflight';
import { refreshUpdateCache } from './refresh';
import {
  fetchLatestReleaseManifest,
  type FetchReleaseManifestResult,
} from './release-manifest';
import { selectUpdateTarget } from './select';
import { detectInstallSource } from './source';
import {
  type InstallSource,
  type UpdateCache,
  type UpdateInstallState,
} from './types';

export { SUPERLIORA_CHANGELOG_URL };

/** Tip of GitHub `main` — used when `--main` skips published releases. */
export const MAIN_TIP_UPSTREAM = 'origin/main';

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
  /** Skip CDN/release; install tip of `main` from source. */
  readonly fromMain: boolean;
  /** Explicit checkout root for github-checkout installs (e.g. ~/.superliora/source). */
  readonly checkoutRoot?: string;
}

export interface ResolveUpgradePlanOptions {
  /** Ignore published releases; upgrade to tip of `origin/main`. */
  readonly fromMain?: boolean;
}

export interface ResolveUpgradePlanDeps {
  readonly detectInstallSource: () => Promise<InstallSource>;
  readonly refreshGitCheckoutUpdateTarget: (
    repoRoot?: string,
    options?: GitCheckoutUpdateOptions,
  ) => Promise<GitCheckoutRefreshResult>;
  readonly refreshUpdateCache: () => Promise<UpdateCache>;
  /** Native / SEA authority — GitHub Release manifest (not CDN tip). */
  readonly fetchReleaseManifest: () => Promise<FetchReleaseManifestResult>;
  readonly readUpdateInstallState: () => Promise<UpdateInstallState>;
  readonly writeUpdateInstallState: (state: UpdateInstallState) => Promise<void>;
  readonly detectGithubCheckout: (startPath?: string) => Promise<string | null>;
  readonly defaultSourceInstallDir: () => string;
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
  readonly fromMain: boolean;
  readonly checkoutRoot?: string;
  readonly errorMessage?: string;
}

function resolveDeps(overrides: Partial<ResolveUpgradePlanDeps>): ResolveUpgradePlanDeps {
  return {
    detectInstallSource: overrides.detectInstallSource ?? (() => detectInstallSource()),
    refreshGitCheckoutUpdateTarget:
      overrides.refreshGitCheckoutUpdateTarget ??
      ((repoRoot, options) =>
        refreshGitCheckoutUpdateTarget(repoRoot ?? findGitCheckoutRoot() ?? '', options)),
    refreshUpdateCache: overrides.refreshUpdateCache ?? (() => refreshUpdateCache()),
    fetchReleaseManifest:
      overrides.fetchReleaseManifest ?? (() => fetchLatestReleaseManifest()),
    readUpdateInstallState: overrides.readUpdateInstallState ?? (() => readUpdateInstallState()),
    writeUpdateInstallState:
      overrides.writeUpdateInstallState ?? ((state) => writeUpdateInstallState(state)),
    detectGithubCheckout:
      overrides.detectGithubCheckout ?? ((startPath) => detectSuperLioraGithubCheckout(startPath)),
    defaultSourceInstallDir:
      overrides.defaultSourceInstallDir ?? (() => join(homedir(), '.superliora', 'source')),
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
    installCommand: installCommandFor(input.source, versionForCommand, input.platform, {
      fromMain: input.fromMain,
      checkoutRoot: input.checkoutRoot,
    }),
    changelogUrl: SUPERLIORA_CHANGELOG_URL,
    dirty: input.dirty,
    canAutoInstall: input.canAutoInstall,
    reason: input.reason,
    fromMain: input.fromMain,
    ...(input.checkoutRoot !== undefined ? { checkoutRoot: input.checkoutRoot } : {}),
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  };
}

async function resolveMainCheckoutRoot(deps: ResolveUpgradePlanDeps): Promise<string | null> {
  const fromPackage = await deps.detectGithubCheckout().catch(() => null);
  if (fromPackage !== null) return fromPackage;
  return deps.detectGithubCheckout(deps.defaultSourceInstallDir()).catch(() => null);
}

async function planGithubCheckout(
  currentVersion: string,
  deps: ResolveUpgradePlanDeps,
  installState: UpdateInstallState,
  options: {
    readonly fromMain: boolean;
    readonly checkoutRoot?: string;
  },
): Promise<UpgradePlan> {
  const source: InstallSource = 'github-checkout';
  const checkoutRoot = options.checkoutRoot;
  const gitOptions: GitCheckoutUpdateOptions = options.fromMain
    ? { preferredUpstream: MAIN_TIP_UPSTREAM }
    : {};
  try {
    const result = await deps.refreshGitCheckoutUpdateTarget(checkoutRoot, gitOptions);
    if (result.status === 'up-to-date') {
      // Background install may force-checkout first, then fail on pnpm/build.
      // HEAD matches upstream so a naive check reports "up to date" while the
      // running dist is still stale and lastFailure blocks auto-retry.
      // Surface the failed HEAD version as update-available so `liora upgrade`
      // can rebuild/reinstall.
      const failedVersion = installState.lastFailure?.version;
      const headVersion = gitCheckoutVersionLabel(result.upstream, result.head);
      if (failedVersion === headVersion) {
        return basePlan({
          source,
          currentVersion,
          target: { version: headVersion, upstream: result.upstream },
          reason: 'update-available',
          dirty: result.dirty,
          canAutoInstall: canAutoInstall(source, deps.platform),
          platform: deps.platform,
          fromMain: options.fromMain,
          checkoutRoot,
        });
      }
      return basePlan({
        source,
        currentVersion,
        target: null,
        reason: 'up-to-date',
        dirty: result.dirty,
        canAutoInstall: false,
        platform: deps.platform,
        fromMain: options.fromMain,
        checkoutRoot,
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
        fromMain: options.fromMain,
        checkoutRoot,
      });
    }
    // Dirty still surfaces in the plan for UX warnings, but does not block
    // explicit install — the checkout script force-resets like install.sh.
    // Silent background installs gate on dirty separately in preflight.
    return basePlan({
      source,
      currentVersion,
      target: { version: result.target.version, upstream: result.target.upstream },
      reason: 'update-available',
      dirty: result.dirty,
      canAutoInstall: canAutoInstall(source, deps.platform),
      platform: deps.platform,
      fromMain: options.fromMain,
      checkoutRoot: checkoutRoot ?? result.target.repoRoot,
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
      fromMain: options.fromMain,
      checkoutRoot,
    });
  }
}

function planNativeFromMain(currentVersion: string, platform: NodeJS.Platform): UpgradePlan {
  const source: InstallSource = 'native';
  return basePlan({
    source,
    currentVersion,
    target: { version: MAIN_TIP_UPSTREAM, upstream: MAIN_TIP_UPSTREAM },
    reason: 'update-available',
    dirty: false,
    canAutoInstall: canAutoInstall(source, platform),
    platform,
    fromMain: true,
  });
}

export async function resolveUpgradePlan(
  currentVersion: string,
  overrides: Partial<ResolveUpgradePlanDeps> = {},
  options: ResolveUpgradePlanOptions = {},
): Promise<UpgradePlan> {
  const deps = resolveDeps(overrides);
  const fromMain = options.fromMain === true;
  const source = await deps.detectInstallSource().catch(() => 'unsupported' as const);
  let installState = await deps.readUpdateInstallState().catch(() => emptyUpdateInstallState());
  if (hasLiveActiveInstall(installState) && installState.active !== null) {
    return basePlan({
      source,
      currentVersion,
      target: { version: installState.active.version },
      reason: 'already-installing',
      dirty: false,
      canAutoInstall: false,
      platform: deps.platform,
      fromMain,
    });
  }
  if (installState.active !== null) {
    const cleared: UpdateInstallState = { ...installState, active: null };
    await deps.writeUpdateInstallState(cleared).catch(() => {});
    installState = cleared;
  }

  if (fromMain) {
    const checkoutRoot = await resolveMainCheckoutRoot(deps);
    if (checkoutRoot !== null) {
      return planGithubCheckout(currentVersion, deps, installState, {
        fromMain: true,
        checkoutRoot,
      });
    }
    return planNativeFromMain(currentVersion, deps.platform);
  }

  if (source === 'github-checkout') {
    return planGithubCheckout(currentVersion, deps, installState, { fromMain: false });
  }

  try {
    // SEA/native: GitHub Release manifest is authority so advertise == install.
    // Package managers still use CDN tip (+ rollout manifest).
    const latest =
      source === 'native'
        ? (await deps.fetchReleaseManifest()).version
        : (await deps.refreshUpdateCache()).latest;
    const target = selectUpdateTarget(currentVersion, latest);
    if (target === null) {
      return basePlan({
        source,
        currentVersion,
        target: null,
        reason: 'up-to-date',
        dirty: false,
        canAutoInstall: false,
        platform: deps.platform,
        fromMain: false,
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
      fromMain: false,
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
      fromMain: false,
    });
  }
}
