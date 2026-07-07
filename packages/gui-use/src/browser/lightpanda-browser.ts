import type { ChildProcess } from 'node:child_process';
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
  findFreePort,
  isLightpandaPlatformSupported,
  lightpandaUnsupportedStatus,
  setupResultDetail,
  statusFromSetupResult,
  throwIfAborted,
} from './browser-support';
import {
  infoLightpandaBinary,
  installLightpandaBinary,
  resolveLightpandaBinaryPath,
  type LightpandaBinaryOptions,
} from './lightpanda-binary';
import { PlaywrightPageHarness } from './playwright-page-harness';

export interface LightpandaBrowserRuntimeOptions extends LightpandaBinaryOptions {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly obeyRobots?: boolean | undefined;
  readonly autoInstall?: boolean | undefined;
  readonly installRoot?: string | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly allowUnsafeEval?: boolean | undefined;
  readonly inactiveCleanupMs?: number | undefined;
  readonly install?: (() => Promise<SetupCommandResult>) | undefined;
  readonly info?: (() => Promise<SetupCommandResult>) | undefined;
}

export class LightpandaBrowserRuntime implements BrowserUseRuntime {
  private readonly harness: PlaywrightPageHarness;
  private serverProcess: ChildProcess | undefined;
  private installAttempt: Promise<SetupCommandResult> | undefined;

  constructor(private readonly options: LightpandaBrowserRuntimeOptions = {}) {
    this.harness = new PlaywrightPageHarness(
      (signal) => this.connectBrowser(signal),
      {
        viewport: options.viewport,
        allowUnsafeEval: options.allowUnsafeEval,
        inactiveCleanupMs: options.inactiveCleanupMs,
      },
      () => this.stopServer(),
    );
  }

  async status(
    input: BrowserStatusInput = {},
    signal?: AbortSignal,
  ): Promise<BrowserStatus> {
    throwIfAborted(signal);
    if (!isLightpandaPlatformSupported()) return lightpandaUnsupportedStatus();

    const before = await this.infoLightpanda();
    if (before.ok) return statusFromSetupResult(before, true, 'lightpanda');

    if (input.installIfMissing === false || !this.shouldAutoInstall()) {
      return statusFromSetupResult(before, false, 'lightpanda');
    }

    const installed = await this.installLightpanda(signal);
    if (!installed.ok) {
      return {
        platform: process.platform,
        provider: 'lightpanda',
        installed: false,
        ready: false,
        command: installed.command,
        error: `Lightpanda auto-install failed: ${setupResultDetail(installed)}`,
      };
    }

    throwIfAborted(signal);
    const after = await this.infoLightpanda();
    if (after.ok) return statusFromSetupResult(after, true, 'lightpanda');
    return {
      ...statusFromSetupResult(after, false, 'lightpanda'),
      error: `Lightpanda install completed but the runtime is still unavailable: ${setupResultDetail(after)}`,
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
    if (!isLightpandaPlatformSupported()) {
      throw new Error(lightpandaUnsupportedStatus().error);
    }

    try {
      return await this.launchOverCdp();
    } catch (firstError) {
      if (!this.shouldAutoInstall()) {
        throw new Error(actionableLaunchError(firstError, 'lightpanda'));
      }

      const installed = await this.installLightpanda(signal);
      if (!installed.ok) {
        throw new Error(
          `${actionableLaunchError(firstError, 'lightpanda')}\n` +
          `Lightpanda auto-install failed: ${setupResultDetail(installed)}`,
        );
      }

      throwIfAborted(signal);
      try {
        return await this.launchOverCdp();
      } catch (secondError) {
        throw new Error(
          `Lightpanda launch failed after auto-install: ${describeError(secondError)}. ` +
          `Initial launch error: ${describeError(firstError)}. ` +
          'Use BrowserStatus or `liora browser-use doctor` for diagnostics.',
        );
      }
    }
  }

  private async launchOverCdp(): Promise<Browser> {
    const { chromium } = await import('playwright-core');
    const { spawn } = await import('node:child_process');
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? await findFreePort(host);
    const binaryPath = resolveLightpandaBinaryPath(this.options);
    const args = [
      'serve',
      '--host',
      host,
      '--port',
      String(port),
    ];
    if (this.options.obeyRobots === true) args.push('--obey-robots');

    this.serverProcess = spawn(binaryPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await waitForCdpReady(host, port);
    const browser = await chromium.connectOverCDP(`http://${host}:${String(port)}`);
    if (browser === undefined) {
      throw new Error('Lightpanda CDP connection did not return a browser.');
    }
    return browser;
  }

  private async stopServer(): Promise<void> {
    const proc = this.serverProcess;
    this.serverProcess = undefined;
    if (proc === undefined) return;
    proc.kill();
  }

  private async infoLightpanda(): Promise<SetupCommandResult> {
    return (this.options.info ?? (() => infoLightpandaBinary(this.options)))();
  }

  private async installLightpanda(signal?: AbortSignal): Promise<SetupCommandResult> {
    throwIfAborted(signal);
    this.installAttempt ??= (this.options.install ?? (() => installLightpandaBinary(this.options)))();
    const result = await this.installAttempt;
    if (!result.ok) this.installAttempt = undefined;
    return result;
  }

  private shouldAutoInstall(): boolean {
    if (this.options.autoInstall === false) return false;
    if (this.options.binaryPath !== undefined) return false;
    if (process.env['LIGHTPANDA_EXECUTABLE_PATH'] !== undefined) return false;
    return true;
  }
}

async function waitForCdpReady(host: string, port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${String(port)}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Lightpanda CDP server did not become ready on ${host}:${String(port)}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
