import { describe, expect, it, vi } from 'vitest';

import { handleUpgrade } from '#/cli/sub/upgrade';
import type { UpgradePlan } from '#/cli/update/plan';
import type { InstallPromptChoiceValue } from '#/cli/update/prompt';
import type { InstallSource } from '#/cli/update/types';

const CHANGELOG_URL = 'https://github.com/claudianus/superliora/releases';

function captureOutput(): {
  stdout: string[];
  stderr: string[];
  writable: {
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writable: {
      stdout: { write: (chunk: string) => { stdout.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
    },
  };
}

function basePlan(overrides: Partial<UpgradePlan> & Pick<UpgradePlan, 'reason' | 'source'>): UpgradePlan {
  return {
    currentVersion: '0.4.0',
    target: null,
    installCommand: 'npm install -g @superliora/liora@0.5.0',
    changelogUrl: CHANGELOG_URL,
    dirty: false,
    canAutoInstall: false,
    ...overrides,
  };
}

function createDeps(overrides: {
  readonly plan?: UpgradePlan;
  readonly isInteractive?: boolean;
  readonly promptForInstallChoice?: () => Promise<InstallPromptChoiceValue>;
  readonly installUpdate?: (source: InstallSource, version: string, platform: NodeJS.Platform) => Promise<void>;
} = {}) {
  const installUpdate =
    overrides.installUpdate ??
    vi.fn<(
      source: InstallSource,
      version: string,
      platform: NodeJS.Platform,
    ) => Promise<void>>().mockResolvedValue(undefined);

  const plan =
    overrides.plan ??
    basePlan({
      reason: 'update-available',
      source: 'npm-global',
      target: { version: '0.5.0' },
      canAutoInstall: true,
      installCommand: 'npm install -g @superliora/liora@0.5.0',
    });

  return {
    resolveUpgradePlan: vi.fn().mockResolvedValue(plan),
    promptForInstallChoice:
      overrides.promptForInstallChoice ?? vi.fn().mockResolvedValue('install'),
    installUpdate,
    track: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    updateGuiUseAfterUpgrade: vi.fn().mockResolvedValue(undefined),
    platform: 'darwin' as NodeJS.Platform,
    isInteractive: overrides.isInteractive ?? true,
  };
}

describe('handleUpgrade', () => {
  it('prompts before installing the latest version when the install source supports it', async () => {
    const { stdout, stderr, writable } = captureOutput();
    const deps = createDeps();

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.resolveUpgradePlan).toHaveBeenCalledWith('0.4.0');
    expect(deps.promptForInstallChoice).toHaveBeenCalledWith({
      currentVersion: '0.4.0',
      target: { version: '0.5.0' },
      installCommand: 'npm install -g @superliora/liora@0.5.0',
      installSource: 'npm-global',
    });
    expect(deps.installUpdate).toHaveBeenCalledWith('npm-global', '0.5.0', 'darwin');
    expect(deps.updateGuiUseAfterUpgrade).toHaveBeenCalledTimes(1);
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_prompted', expect.objectContaining({
      current_version: '0.4.0',
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_install_selected', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_succeeded', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(deps.logger.info).toHaveBeenCalledWith('manual upgrade install succeeded', expect.objectContaining({
      targetVersion: '0.5.0',
      source: 'npm-global',
    }));
    expect(stdout.join('')).toContain('Updated @superliora/liora to 0.5.0');
    expect(stderr.join('')).toBe('');
  });

  it('skips the foreground install when the update prompt is declined', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({
      promptForInstallChoice: vi.fn().mockResolvedValue('skip'),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.promptForInstallChoice).toHaveBeenCalledTimes(1);
    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.updateGuiUseAfterUpgrade).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_skipped', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(stdout.join('')).toBe('');
  });

  it('prints up-to-date status after checking for a GitHub checkout source', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({
      plan: basePlan({
        reason: 'up-to-date',
        source: 'npm-global',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.resolveUpgradePlan).toHaveBeenCalledWith('0.4.0');
    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.updateGuiUseAfterUpgrade).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_no_update', expect.objectContaining({
      current_version: '0.4.0',
    }));
    expect(stdout.join('')).toContain('SuperLiora is already up to date (v0.4.0).');
  });

  it('prints the manual update command when the install source cannot be auto-installed', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({
      plan: basePlan({
        reason: 'update-available',
        source: 'unsupported',
        target: { version: '0.5.0' },
        canAutoInstall: false,
        installCommand: 'npm install -g @superliora/liora@0.5.0',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.updateGuiUseAfterUpgrade).not.toHaveBeenCalled();
    expect(deps.promptForInstallChoice).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_manual_command', expect.objectContaining({
      target_version: '0.5.0',
      source: 'unsupported',
    }));
    expect(stdout.join('')).toContain('To update manually, run: npm install -g @superliora/liora@0.5.0');
  });

  it('prints the manual update command without prompting when not interactive', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({ isInteractive: false });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.promptForInstallChoice).not.toHaveBeenCalled();
    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.updateGuiUseAfterUpgrade).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_manual_command', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(stdout.join('')).toContain('To update manually, run: npm install -g @superliora/liora@0.5.0');
  });

  it('installs a newer GitHub checkout target without consulting the CDN cache', async () => {
    const { stdout, stderr, writable } = captureOutput();
    const deps = createDeps({
      plan: basePlan({
        reason: 'update-available',
        source: 'github-checkout',
        target: { version: 'origin/main@abcdef123456' },
        canAutoInstall: true,
        installCommand: 'bash -lc \'set -e; git pull\'',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.resolveUpgradePlan).toHaveBeenCalledWith('0.4.0');
    expect(deps.promptForInstallChoice).toHaveBeenCalledWith(expect.objectContaining({
      installCommand: expect.stringContaining('bash -lc'),
      installSource: 'github-checkout',
      target: { version: 'origin/main@abcdef123456' },
    }));
    expect(deps.installUpdate).toHaveBeenCalledWith(
      'github-checkout',
      'origin/main@abcdef123456',
      'darwin',
    );
    expect(deps.updateGuiUseAfterUpgrade).toHaveBeenCalledTimes(1);
    expect(stdout.join('')).toContain('Updated SuperLiora from GitHub');
    expect(stderr.join('')).toBe('');
  });

  it('reports an up-to-date GitHub checkout without querying semver releases', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({
      plan: basePlan({
        reason: 'up-to-date',
        source: 'github-checkout',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.resolveUpgradePlan).toHaveBeenCalledWith('0.4.0');
    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.updateGuiUseAfterUpgrade).not.toHaveBeenCalled();
    expect(stdout.join('')).toContain('SuperLiora GitHub checkout is already up to date.');
  });

  it('prints a manual GitHub checkout update command when not interactive', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({
      isInteractive: false,
      plan: basePlan({
        reason: 'update-available',
        source: 'github-checkout',
        target: { version: 'origin/main@abcdef123456' },
        canAutoInstall: true,
        installCommand: 'bash -lc \'set -e; git pull\'',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.promptForInstallChoice).not.toHaveBeenCalled();
    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.updateGuiUseAfterUpgrade).not.toHaveBeenCalled();
    expect(stdout.join('')).toContain('Detected install source: GitHub checkout');
    expect(stdout.join('')).toContain('bash -lc');
  });

  it('returns a failing exit code when the foreground install fails', async () => {
    const { stderr, writable } = captureOutput();
    const deps = createDeps({
      installUpdate: vi.fn().mockRejectedValue(new Error('npm exited with code 1')),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(1);

    expect(stderr.join('')).toContain(
      'warning: failed to install @superliora/liora@0.5.0: npm exited with code 1',
    );
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_failed', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
      stage: 'install',
    }));
    expect(deps.logger.warn).toHaveBeenCalledWith('manual upgrade install failed', expect.objectContaining({
      targetVersion: '0.5.0',
      source: 'npm-global',
    }));
  });

  it('returns a failing exit code when checking the latest version fails', async () => {
    const { stderr, writable } = captureOutput();
    const deps = createDeps({
      plan: basePlan({
        reason: 'check-failed',
        source: 'npm-global',
        errorMessage: 'cdn unavailable',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(1);

    expect(deps.resolveUpgradePlan).toHaveBeenCalledWith('0.4.0');
    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledWith('upgrade_command_failed', expect.objectContaining({
      current_version: '0.4.0',
      stage: 'refresh',
    }));
    expect(stderr.join('')).toContain('error: failed to check for updates: cdn unavailable');
  });

  it('ignores rollout gating: installs the latest version while every batch is still held', async () => {
    const { stdout, writable } = captureOutput();
    // Manual upgrade plans always surface the latest CDN version; rollout
    // gating is a passive-update concern only.
    const deps = createDeps({
      plan: basePlan({
        reason: 'update-available',
        source: 'npm-global',
        target: { version: '0.5.0' },
        canAutoInstall: true,
        installCommand: 'npm install -g @superliora/liora@0.5.0',
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.installUpdate).toHaveBeenCalledWith('npm-global', '0.5.0', 'darwin');
    expect(deps.updateGuiUseAfterUpgrade).toHaveBeenCalledTimes(1);
    expect(stdout.join('')).toContain('Updated @superliora/liora to 0.5.0');
  });

  it('reports when an install is already in progress', async () => {
    const { stdout, writable } = captureOutput();
    const deps = createDeps({
      plan: basePlan({
        reason: 'already-installing',
        source: 'npm-global',
        target: { version: '0.5.0' },
      }),
    });

    await expect(handleUpgrade('0.4.0', { ...deps, ...writable })).resolves.toBe(0);

    expect(deps.installUpdate).not.toHaveBeenCalled();
    expect(stdout.join('')).toContain('An update install is already in progress (0.5.0).');
  });
});
