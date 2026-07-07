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
import { describeError } from './browser-support';

export class TieredBrowserUseRuntime implements BrowserUseRuntime {
  constructor(
    private readonly primary: BrowserUseRuntime,
    private readonly fallback: BrowserUseRuntime | undefined,
    private readonly primaryProvider: string,
    private readonly fallbackProvider: string | undefined,
  ) {}

  async status(
    input: BrowserStatusInput = {},
    signal?: AbortSignal,
  ): Promise<BrowserStatus> {
    const primaryStatus = await this.primary.status(input, signal);
    if (this.fallback === undefined) return primaryStatus;

    const fallbackStatus = await this.fallback.status(
      { installIfMissing: input.installIfMissing },
      signal,
    );
    const ready = primaryStatus.ready === true || fallbackStatus.ready === true;
    const installed = primaryStatus.installed === true || fallbackStatus.installed === true;
    const versionParts = [
      formatProviderVersion(this.primaryProvider, primaryStatus),
      formatProviderVersion(this.fallbackProvider, fallbackStatus),
    ].filter((part) => part.length > 0);

    return {
      platform: primaryStatus.platform,
      provider: this.primaryProvider,
      fallbackProvider: this.fallbackProvider,
      installed,
      ready,
      version: versionParts.join('; ') || undefined,
      command: primaryStatus.command ?? fallbackStatus.command,
      error: ready
        ? undefined
        : firstError(primaryStatus.error, fallbackStatus.error),
    };
  }

  async observe(input?: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation> {
    return this.withFallback(
      (runtime) => runtime.observe(input, signal),
      'observe',
    );
  }

  async screenshot(input?: BrowserScreenshotInput, signal?: AbortSignal): Promise<RuntimeImage> {
    return this.withFallback(
      (runtime) => runtime.screenshot(input, signal),
      'screenshot',
    );
  }

  async act(input: BrowserActInput, signal?: AbortSignal): Promise<BrowserActResult> {
    return this.withFallback(
      (runtime) => runtime.act(input, signal),
      'act',
    );
  }

  async console(input?: BrowserConsoleInput, signal?: AbortSignal): Promise<BrowserConsoleResult> {
    return this.withFallback(
      (runtime) => runtime.console(input, signal),
      'console',
    );
  }

  async close(): Promise<void> {
    await Promise.all([
      this.primary.close().catch(() => undefined),
      this.fallback?.close().catch(() => undefined),
    ]);
  }

  private async withFallback<T>(
    run: (runtime: BrowserUseRuntime) => Promise<T>,
    operation: string,
  ): Promise<T> {
    try {
      return await run(this.primary);
    } catch (primaryError) {
      if (this.fallback === undefined) throw primaryError;
      await this.primary.close().catch(() => undefined);
      try {
        return await run(this.fallback);
      } catch (fallbackError) {
        throw new Error(
          `${this.primaryProvider} ${operation} failed: ${describeError(primaryError)}. ` +
          `${this.fallbackProvider ?? 'fallback'} ${operation} failed: ${describeError(fallbackError)}.`,
        );
      }
    }
  }
}

function formatProviderVersion(
  provider: string | undefined,
  status: BrowserStatus,
): string {
  if (provider === undefined) return '';
  const version = status.version?.trim();
  if (version === undefined || version.length === 0) {
    return `${provider}=${status.ready === true ? 'ready' : 'unavailable'}`;
  }
  return `${provider}=${version}`;
}

function firstError(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}
