import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ICoreProcessService,
  type ILogService,
  type IModelCatalogService,
  type KimiConfig,
} from '@moonshot-ai/agent-core';

import {
  DEFAULT_MODEL_CATALOG_REFRESH_INTERVAL_MS,
  ModelCatalogRefreshScheduler,
} from '#/services/modelCatalog/modelCatalogRefreshScheduler';

class TestLogger implements ILogService {
  readonly _serviceBrand: undefined;
  readonly warnings: Array<{ obj: object | string; msg?: string }> = [];

  info(): void {}
  warn(obj: object | string, msg?: string): void {
    this.warnings.push({ obj, msg });
  }
  error(): void {}
  debug(): void {}
  child(): ILogService {
    return this;
  }
}

function makeConfig(modelCatalog?: KimiConfig['modelCatalog']): KimiConfig {
  return { providers: {}, modelCatalog };
}

function makeCore(config: KimiConfig): ICoreProcessService {
  return {
    _serviceBrand: undefined,
    rpc: {
      getKimiConfig: vi.fn(async () => config),
    },
    ready: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } as unknown as ICoreProcessService;
}

function makeCatalog(impl?: () => Promise<unknown>): IModelCatalogService {
  return {
    _serviceBrand: undefined,
    listModels: vi.fn(),
    listProviders: vi.fn(),
    getProvider: vi.fn(),
    setDefaultModel: vi.fn(),
    refreshOAuthProviderModels: vi.fn(),
    refreshProviderModels: vi.fn(async () => {
      await impl?.();
      return { changed: [], unchanged: [], failed: [] };
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env['KIMI_CODE_MODEL_CATALOG_REFRESH_INTERVAL_MS'];
  delete process.env['KIMI_CODE_MODEL_CATALOG_REFRESH_ON_START'];
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env['KIMI_CODE_MODEL_CATALOG_REFRESH_INTERVAL_MS'];
  delete process.env['KIMI_CODE_MODEL_CATALOG_REFRESH_ON_START'];
});

describe('ModelCatalogRefreshScheduler', () => {
  it('refreshes on start and on the configured interval', async () => {
    const catalog = makeCatalog();
    const scheduler = new ModelCatalogRefreshScheduler(
      catalog,
      makeCore(makeConfig({ refreshIntervalMs: 1000, refreshOnStart: true })),
      new TestLogger(),
    );

    await scheduler.start();

    expect(catalog.refreshProviderModels).toHaveBeenCalledTimes(1);
    expect(catalog.refreshProviderModels).toHaveBeenLastCalledWith({ scope: 'all' });

    await vi.advanceTimersByTimeAsync(1000);

    expect(catalog.refreshProviderModels).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(3000);
    expect(catalog.refreshProviderModels).toHaveBeenCalledTimes(2);
  });

  it('does nothing when start refresh is off and interval is zero', async () => {
    const catalog = makeCatalog();
    const scheduler = new ModelCatalogRefreshScheduler(
      catalog,
      makeCore(makeConfig({ refreshIntervalMs: 0, refreshOnStart: false })),
      new TestLogger(),
    );

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_MODEL_CATALOG_REFRESH_INTERVAL_MS);

    expect(catalog.refreshProviderModels).not.toHaveBeenCalled();
  });

  it('lets environment variables override config values', async () => {
    process.env['KIMI_CODE_MODEL_CATALOG_REFRESH_INTERVAL_MS'] = '250';
    process.env['KIMI_CODE_MODEL_CATALOG_REFRESH_ON_START'] = '1';

    const catalog = makeCatalog();
    const scheduler = new ModelCatalogRefreshScheduler(
      catalog,
      makeCore(makeConfig({ refreshIntervalMs: 0, refreshOnStart: false })),
      new TestLogger(),
    );

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(catalog.refreshProviderModels).toHaveBeenCalledTimes(2);
  });

  it('logs refresh errors without throwing from the scheduler loop', async () => {
    const logger = new TestLogger();
    const catalog = makeCatalog(async () => {
      throw new Error('catalog down');
    });
    const scheduler = new ModelCatalogRefreshScheduler(
      catalog,
      makeCore(makeConfig({ refreshIntervalMs: 0, refreshOnStart: true })),
      logger,
    );

    await scheduler.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(catalog.refreshProviderModels).toHaveBeenCalledTimes(1);
    expect(logger.warnings.some((entry) => entry.msg === 'provider model catalog refresh failed')).toBe(true);
  });
});
