import type { Browser } from 'playwright-core';

import type { SetupCommandResult } from '../install';
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
import {
  infoCamoufoxBinary,
  installCamoufoxBinary,
  resolveCamoufoxBinaryPath,
  type CamoufoxBinaryOptions,
} from './camoufox-binary';
import { PlaywrightPageHarness } from './playwright-page-harness';

export interface CamoufoxBrowserRuntimeOptions extends CamoufoxBinaryOptions {
  readonly headless?: boolean | undefined;
  readonly autoInstall?: boolean | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly allowUnsafeEval?: boolean | undefined;
  readonly inactiveCleanupMs?: number | undefined;
  readonly install?: (() => Promise<SetupCommandResult>) | undefined;
  readonly info?: (() => Promise<SetupCommandResult>) | undefined;
}

export class CamoufoxBrowserRuntime implements BrowserUseRuntime {
  private readonly harness: PlaywrightPageHarness;
  private installAttempt: Promise<SetupCommandResult> | undefined;

  constructor(private readonly options: CamoufoxBrowserRuntimeOptions = {}) {
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
    const before = await this.infoCamoufox();
    if (before.ok) return statusFromSetupResult(before, true, 'camoufox');

    if (input.installIfMissing === false || !this.shouldAutoInstall()) {
      return statusFromSetupResult(before, false, 'camoufox');
    }

    const installed = await this.installCamoufox(signal);
    if (!installed.ok) {
      return {
        platform: process.platform,
        provider: 'camoufox',
        installed: false,
        ready: false,
        command: installed.command,
        error: `Camoufox auto-install failed: ${setupResultDetail(installed)}`,
      };
    }

    throwIfAborted(signal);
    const after = await this.infoCamoufox();
    if (after.ok) return statusFromSetupResult(after, true, 'camoufox');
    return {
      ...statusFromSetupResult(after, false, 'camoufox'),
      error: `Camoufox install completed but the runtime is still unavailable: ${setupResultDetail(after)}`,
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
    throwIfAborted(signal);
    const { firefox } = await import('playwright-core');
    const launch = async () => firefox.launch({
      executablePath: resolveCamoufoxBinaryPath(this.options),
      headless: this.options.headless ?? true,
    });
    try {
      return await launch();
    } catch (firstError) {
      if (!this.shouldAutoInstall()) {
        throw new Error(actionableLaunchError(firstError, 'camoufox'));
      }

      const installed = await this.installCamoufox(signal);
      if (!installed.ok) {
        throw new Error(
          `${actionableLaunchError(firstError, 'camoufox')}\n` +
          `Camoufox auto-install failed: ${setupResultDetail(installed)}`,
        );
      }

      throwIfAborted(signal);
      try {
        return await launch();
      } catch (secondError) {
        throw new Error(
          `Camoufox launch failed after auto-install: ${describeError(secondError)}. ` +
          `Initial launch error: ${describeError(firstError)}. ` +
          'Use BrowserStatus or `liora browser-use doctor` for diagnostics.',
        );
      }
    }
  }

  private async infoCamoufox(): Promise<SetupCommandResult> {
    return (this.options.info ?? (() => infoCamoufoxBinary(this.options)))();
  }

  private async installCamoufox(signal?: AbortSignal): Promise<SetupCommandResult> {
    throwIfAborted(signal);
    this.installAttempt ??= (this.options.install ?? (() => installCamoufoxBinary(this.options)))();
    const result = await this.installAttempt;
    if (!result.ok) this.installAttempt = undefined;
    return result;
  }

  private shouldAutoInstall(): boolean {
    if (this.options.autoInstall === false) return false;
    if (this.options.binaryPath !== undefined) return false;
    if (process.env['CAMOUFOX_EXECUTABLE_PATH'] !== undefined) return false;
    return true;
  }
}
