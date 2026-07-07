import type { Browser } from 'playwright-core';

import {
  infoCloakBrowser,
  installCloakBrowser,
  type SetupCommandResult,
} from '../install';
import type {
  BrowserActInput,
  BrowserActResult,
  BrowserConsoleInput,
  BrowserConsoleResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserScreenshotInput,
  BrowserStatus,
  BrowserStatusInput,
  BrowserUseRuntime,
  RuntimeImage,
} from '../types';
import {
  actionableLaunchError,
  describeError,
  setupResultDetail,
  statusFromSetupResult,
  throwIfAborted,
} from './browser-support';
import { PlaywrightPageHarness } from './playwright-page-harness';

export interface CloakBrowserRuntimeOptions {
  readonly headless?: boolean | undefined;
  readonly humanize?: boolean | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly autoInstall?: boolean | undefined;
  readonly autoUpdate?: boolean | undefined;
  readonly cacheDir?: string | undefined;
  readonly binaryPath?: string | undefined;
  readonly version?: string | undefined;
  readonly licenseKeyEnv?: string | undefined;
  readonly allowUnsafeEval?: boolean | undefined;
  readonly inactiveCleanupMs?: number | undefined;
  readonly installRoot?: string | undefined;
  readonly install?: (() => Promise<SetupCommandResult>) | undefined;
  readonly info?: (() => Promise<SetupCommandResult>) | undefined;
}

export class CloakBrowserRuntime implements BrowserUseRuntime {
  private readonly harness: PlaywrightPageHarness;
  private installAttempt: Promise<SetupCommandResult> | undefined;

  constructor(private readonly options: CloakBrowserRuntimeOptions = {}) {
    this.harness = new PlaywrightPageHarness(
      (signal) => this.connectBrowser(signal),
      {
        viewport: options.viewport,
        allowUnsafeEval: options.allowUnsafeEval,
        inactiveCleanupMs: options.inactiveCleanupMs,
      },
    );
  }

  async status(
    input: BrowserStatusInput = {},
    signal?: AbortSignal,
  ): Promise<BrowserStatus> {
    throwIfAborted(signal);
    const before = await this.infoCloakBrowser();
    if (before.ok) return statusFromSetupResult(before, true, 'cloakbrowser');

    if (input.installIfMissing === false || !this.shouldAutoInstall()) {
      return statusFromSetupResult(before, false, 'cloakbrowser');
    }

    const installed = await this.installCloakBrowser(signal);
    if (!installed.ok) {
      return {
        platform: process.platform,
        provider: 'cloakbrowser',
        installed: false,
        ready: false,
        command: installed.command,
        error: `CloakBrowser auto-install failed: ${setupResultDetail(installed)}`,
      };
    }

    throwIfAborted(signal);
    const after = await this.infoCloakBrowser();
    if (after.ok) return statusFromSetupResult(after, true, 'cloakbrowser');
    return {
      ...statusFromSetupResult(after, false, 'cloakbrowser'),
      error: `CloakBrowser install completed but the runtime is still unavailable: ${setupResultDetail(after)}`,
    };
  }

  observe(input?: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation> {
    return this.harness.observe(input, signal);
  }

  screenshot(input?: BrowserScreenshotInput, signal?: AbortSignal): Promise<RuntimeImage> {
    return this.harness.screenshot(input, signal);
  }

  act(input: BrowserActInput, signal?: AbortSignal): Promise<BrowserActResult> {
    return this.harness.act(input, signal);
  }

  console(input?: BrowserConsoleInput, signal?: AbortSignal): Promise<BrowserConsoleResult> {
    return this.harness.console(input, signal);
  }

  close(): Promise<void> {
    return this.harness.close();
  }

  private async connectBrowser(signal?: AbortSignal): Promise<Browser> {
    const { launch } = await import('cloakbrowser');
    try {
      return await this.launchWith(launch);
    } catch (firstError) {
      if (!this.shouldAutoInstall()) {
        throw new Error(actionableLaunchError(firstError, 'cloakbrowser'));
      }

      const installed = await this.installCloakBrowser(signal);
      if (!installed.ok) {
        throw new Error(
          `${actionableLaunchError(firstError, 'cloakbrowser')}\n` +
          `CloakBrowser auto-install failed: ${setupResultDetail(installed)}`,
        );
      }

      throwIfAborted(signal);
      try {
        return await this.launchWith(launch);
      } catch (secondError) {
        throw new Error(
          `CloakBrowser launch failed after auto-install: ${describeError(secondError)}. ` +
          `Initial launch error: ${describeError(firstError)}. ` +
          'Use BrowserStatus or `liora browser-use doctor` for diagnostics.',
        );
      }
    }
  }

  private async launchWith(launch: typeof import('cloakbrowser')['launch']): Promise<Browser> {
    return withCloakEnv(this.options, async () => {
      const browser = await launch({
        headless: this.options.headless ?? true,
        humanize: this.options.humanize ?? true,
      } as never) as Browser;
      if (browser === undefined) {
        throw new Error('CloakBrowser launch did not return a browser.');
      }
      return browser;
    });
  }

  private async infoCloakBrowser(): Promise<SetupCommandResult> {
    return (this.options.info ?? (() => infoCloakBrowser({
      quiet: true,
      packageRoot: this.options.installRoot,
    })))();
  }

  private async installCloakBrowser(signal?: AbortSignal): Promise<SetupCommandResult> {
    throwIfAborted(signal);
    this.installAttempt ??= (this.options.install ?? (() => installCloakBrowser({
      quiet: true,
      packageRoot: this.options.installRoot,
    })))();
    const result = await this.installAttempt;
    if (!result.ok) this.installAttempt = undefined;
    return result;
  }

  private shouldAutoInstall(): boolean {
    if (this.options.autoInstall === false) return false;
    if (this.options.binaryPath !== undefined) return false;
    if (process.env['CLOAKBROWSER_BINARY_PATH'] !== undefined) return false;
    return true;
  }
}

async function withCloakEnv<T>(
  options: CloakBrowserRuntimeOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const updates: Record<string, string | undefined> = {
    CLOAKBROWSER_AUTO_UPDATE: options.autoUpdate === false ? 'false' : undefined,
    CLOAKBROWSER_CACHE_DIR: options.cacheDir,
    CLOAKBROWSER_BINARY_PATH: options.binaryPath,
    CLOAKBROWSER_VERSION: options.version,
  };
  if (options.licenseKeyEnv !== undefined) {
    const value = process.env[options.licenseKeyEnv];
    if (value !== undefined) updates['CLOAKBROWSER_LICENSE_KEY'] = value;
  }

  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      if (key === 'CLOAKBROWSER_AUTO_UPDATE' && options.autoUpdate !== false) continue;
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
