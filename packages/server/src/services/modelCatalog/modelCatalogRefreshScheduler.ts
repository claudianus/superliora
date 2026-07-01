import {
  createDecorator,
  Disposable,
  ICoreProcessService,
  ILogService,
  IModelCatalogService,
  toDisposable,
  type KimiConfig,
} from '@moonshot-ai/agent-core';

export interface IModelCatalogRefreshScheduler {
  readonly _serviceBrand: undefined;
  start(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const IModelCatalogRefreshScheduler =
  createDecorator<IModelCatalogRefreshScheduler>('modelCatalogRefreshScheduler');

export const DEFAULT_MODEL_CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const REFRESH_INTERVAL_ENV = 'KIMI_CODE_MODEL_CATALOG_REFRESH_INTERVAL_MS';
const REFRESH_ON_START_ENV = 'KIMI_CODE_MODEL_CATALOG_REFRESH_ON_START';

export class ModelCatalogRefreshScheduler
  extends Disposable
  implements IModelCatalogRefreshScheduler {
  readonly _serviceBrand: undefined;

  private _started = false;

  constructor(
    @IModelCatalogService private readonly modelCatalog: IModelCatalogService,
    @ICoreProcessService private readonly core: ICoreProcessService,
    @ILogService private readonly logger: ILogService,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    const config = await this.core.rpc.getKimiConfig({ reload: true });
    const intervalMs = resolveRefreshIntervalMs(config, process.env);
    const refreshOnStart = resolveRefreshOnStart(config, process.env);

    if (refreshOnStart) {
      void this._refresh('startup');
    }

    if (intervalMs > 0) {
      const timer = setInterval(() => {
        void this._refresh('interval');
      }, intervalMs);
      timer.unref?.();
      this._register(toDisposable(() => clearInterval(timer)));
    }
  }

  private async _refresh(reason: 'startup' | 'interval'): Promise<void> {
    try {
      const result = await this.modelCatalog.refreshProviderModels({ scope: 'all' });
      if (result.failed.length > 0) {
        this.logger.warn(
          { reason, failed: result.failed },
          'provider model catalog refresh completed with provider failures',
        );
      }
    } catch (error) {
      this.logger.warn(
        { reason, err: error },
        'provider model catalog refresh failed',
      );
    }
  }
}

function resolveRefreshIntervalMs(
  config: KimiConfig,
  env: NodeJS.ProcessEnv,
): number {
  const envValue = parseNonNegativeInteger(env[REFRESH_INTERVAL_ENV]);
  if (envValue !== undefined) return envValue;
  return config.modelCatalog?.refreshIntervalMs ?? DEFAULT_MODEL_CATALOG_REFRESH_INTERVAL_MS;
}

function resolveRefreshOnStart(config: KimiConfig, env: NodeJS.ProcessEnv): boolean {
  const envValue = env[REFRESH_ON_START_ENV];
  if (envValue !== undefined) return isTruthyEnvValue(envValue);
  return config.modelCatalog?.refreshOnStart ?? true;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function isTruthyEnvValue(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
