import type { BrowserUseRuntime } from '../types';
import { isLightpandaPlatformSupported } from './browser-support';
import { CloakBrowserRuntime, type CloakBrowserRuntimeOptions } from './cloak-browser';
import { LightpandaBrowserRuntime, type LightpandaBrowserRuntimeOptions } from './lightpanda-browser';
import { TieredBrowserUseRuntime } from './tiered-browser-use';

export type BrowserUseProvider = 'lightpanda' | 'cloakbrowser';

export interface BrowserUseRuntimeOptions {
  readonly provider?: BrowserUseProvider | undefined;
  readonly fallbackProvider?: BrowserUseProvider | undefined;
  readonly fallbackEnabled?: boolean | undefined;
  readonly installRoot?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly autoInstall?: boolean | undefined;
  readonly autoUpdate?: boolean | undefined;
  readonly cacheDir?: string | undefined;
  readonly binaryPath?: string | undefined;
  readonly version?: string | undefined;
  readonly licenseKeyEnv?: string | undefined;
  readonly allowUnsafeEval?: boolean | undefined;
  readonly inactiveCleanupMs?: number | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly headless?: boolean | undefined;
  readonly humanize?: boolean | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly obeyRobots?: boolean | undefined;
  readonly disableHostVerification?: boolean | undefined;
}

export function createBrowserUseRuntime(
  options: BrowserUseRuntimeOptions = {},
): BrowserUseRuntime {
  const provider = resolvePrimaryProvider(options);
  const fallbackProvider = resolveFallbackProvider(options, provider);
  const shared = {
    installRoot: options.installRoot,
    autoInstall: options.autoInstall,
    viewport: options.viewport,
    allowUnsafeEval: options.allowUnsafeEval,
    inactiveCleanupMs: options.inactiveCleanupMs,
  };

  const primary = createProviderRuntime(provider, options, shared);
  if (fallbackProvider === undefined || options.fallbackEnabled === false) {
    return primary;
  }

  const fallback = createProviderRuntime(fallbackProvider, options, shared);
  return new TieredBrowserUseRuntime(primary, fallback, provider, fallbackProvider);
}

function resolvePrimaryProvider(options: BrowserUseRuntimeOptions): BrowserUseProvider {
  if (options.provider === 'cloakbrowser') return 'cloakbrowser';
  if (options.provider === 'lightpanda' && !isLightpandaPlatformSupported()) {
    return 'cloakbrowser';
  }
  return options.provider ?? 'lightpanda';
}

function resolveFallbackProvider(
  options: BrowserUseRuntimeOptions,
  provider: BrowserUseProvider,
): BrowserUseProvider | undefined {
  if (options.fallbackEnabled === false) return undefined;
  if (options.fallbackProvider !== undefined) {
    if (options.fallbackProvider === provider) return undefined;
    if (options.fallbackProvider === 'lightpanda' && !isLightpandaPlatformSupported()) {
      return provider === 'cloakbrowser' ? undefined : 'cloakbrowser';
    }
    return options.fallbackProvider;
  }
  return provider === 'lightpanda' ? 'cloakbrowser' : undefined;
}

function createProviderRuntime(
  provider: BrowserUseProvider,
  options: BrowserUseRuntimeOptions,
  shared: Pick<
    BrowserUseRuntimeOptions,
    'installRoot' | 'autoInstall' | 'viewport' | 'allowUnsafeEval' | 'inactiveCleanupMs'
  >,
): BrowserUseRuntime {
  if (provider === 'lightpanda') {
    const lightpandaOptions: LightpandaBrowserRuntimeOptions = {
      ...shared,
      host: options.host,
      port: options.port,
      obeyRobots: options.obeyRobots,
      binaryPath: options.binaryPath,
      cacheDir: options.cacheDir,
    };
    return new LightpandaBrowserRuntime(lightpandaOptions);
  }

  const cloakOptions: CloakBrowserRuntimeOptions = {
    ...shared,
    headless: options.headless,
    humanize: options.humanize,
    autoUpdate: options.autoUpdate,
    cacheDir: options.cacheDir,
    binaryPath: options.binaryPath,
    version: options.version,
    licenseKeyEnv: options.licenseKeyEnv,
  };
  return new CloakBrowserRuntime(cloakOptions);
}
