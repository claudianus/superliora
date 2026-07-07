import type { BrowserUseRuntime } from '../types';
import { isLightpandaPlatformSupported } from './browser-support';
import { CamoufoxBrowserRuntime, type CamoufoxBrowserRuntimeOptions } from './camoufox-browser';
import { CloakBrowserRuntime, type CloakBrowserRuntimeOptions } from './cloak-browser';
import { LightpandaBrowserRuntime, type LightpandaBrowserRuntimeOptions } from './lightpanda-browser';
import { TieredBrowserUseRuntime } from './tiered-browser-use';

export type BrowserUseProvider = 'lightpanda' | 'cloakbrowser' | 'camoufox';

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
  const providers = resolveProviderChain(options);
  const shared = {
    installRoot: options.installRoot,
    autoInstall: options.autoInstall,
    viewport: options.viewport,
    allowUnsafeEval: options.allowUnsafeEval,
    inactiveCleanupMs: options.inactiveCleanupMs,
  };

  return createRuntimeChain(providers, options, shared);
}

function resolvePrimaryProvider(options: BrowserUseRuntimeOptions): BrowserUseProvider {
  if (options.provider === 'cloakbrowser') return 'cloakbrowser';
  if (options.provider === 'camoufox') return 'camoufox';
  if (options.provider === 'lightpanda' && !isLightpandaPlatformSupported()) {
    return 'cloakbrowser';
  }
  return options.provider ?? 'cloakbrowser';
}

function resolveProviderChain(
  options: BrowserUseRuntimeOptions,
): readonly BrowserUseProvider[] {
  const primary = resolvePrimaryProvider(options);
  if (options.fallbackEnabled === false) return [primary];
  if (options.fallbackProvider !== undefined) {
    if (options.fallbackProvider === primary) return [primary];
    if (options.fallbackProvider === 'lightpanda' && !isLightpandaPlatformSupported()) {
      return [primary];
    }
    return [primary, options.fallbackProvider];
  }

  if (primary === 'cloakbrowser') {
    return isLightpandaPlatformSupported()
      ? ['cloakbrowser', 'camoufox', 'lightpanda']
      : ['cloakbrowser', 'camoufox'];
  }
  if (primary === 'camoufox') {
    return ['camoufox', 'cloakbrowser'];
  }
  return ['lightpanda', 'cloakbrowser', 'camoufox'];
}

function createRuntimeChain(
  providers: readonly BrowserUseProvider[],
  options: BrowserUseRuntimeOptions,
  shared: Pick<
    BrowserUseRuntimeOptions,
    'installRoot' | 'autoInstall' | 'viewport' | 'allowUnsafeEval' | 'inactiveCleanupMs'
  >,
): BrowserUseRuntime {
  const [provider, fallbackProvider, ...rest] = providers;
  if (provider === undefined) {
    return createProviderRuntime('cloakbrowser', options, shared);
  }
  const primary = createProviderRuntime(provider, options, shared);
  if (fallbackProvider === undefined) return primary;
  const fallback = createRuntimeChain([fallbackProvider, ...rest], options, shared);
  return new TieredBrowserUseRuntime(primary, fallback, provider, fallbackProvider);
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

  if (provider === 'camoufox') {
    const camoufoxOptions: CamoufoxBrowserRuntimeOptions = {
      ...shared,
      headless: options.headless,
      cacheDir: options.cacheDir,
      binaryPath: options.binaryPath,
    };
    return new CamoufoxBrowserRuntime(camoufoxOptions);
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
