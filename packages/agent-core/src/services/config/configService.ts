import { Disposable, InstantiationType, registerSingleton } from '../../di';
import type { LioraConfig, ProviderConfig } from '../../config';
import { transformTomlData } from '../../config/toml-transform';
import type { ConfigResponse, PatchConfigRequest } from '@superliora/protocol';

import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEventService } from '../event/event';
import { IConfigService } from './config';

export class ConfigService extends Disposable implements IConfigService {
  readonly _serviceBrand: undefined;

  constructor(
    @ICoreProcessService private readonly core: ICoreProcessService,
    @IEventService private readonly eventService: IEventService,
  ) {
    super();
  }

  async get(): Promise<ConfigResponse> {
    const config = await this.core.rpc.getKimiConfig({ reload: true });
    return toConfigResponse(config);
  }

  async set(patch: PatchConfigRequest): Promise<ConfigResponse> {
    const camelPatch = transformTomlData(patch as Record<string, unknown>);
    const updated = await this.core.rpc.setKimiConfig(camelPatch);
    const response = toConfigResponse(updated);

    this.eventService.publish({
      type: 'event.config.changed',
      agentId: 'main',
      sessionId: '__global__',
      changedFields: Object.keys(patch),
      config: response,
    });

    return response;
  }
}

function toConfigResponse(config: LioraConfig): ConfigResponse {
  const providers: Record<string, { type: string; base_url?: string; default_model?: string; has_api_key: boolean }> = {};
  for (const [providerId, provider] of Object.entries(config.providers ?? {})) {
    providers[providerId] = {
      type: provider.type,
      base_url: provider.baseUrl,
      default_model: provider.defaultModel,
      has_api_key: hasProviderCredential(provider),
    };
  }

  return {
    providers,
    default_provider: config.defaultProvider,
    default_model: config.defaultModel,
    models: config.models,
    thinking: config.thinking,
    yolo: config.yolo,
    default_thinking: config.defaultThinking,
    default_permission_mode: config.defaultPermissionMode,
    permission: config.permission,
    sandbox_profile: config.sandboxProfile,
    sandbox_enforcement: config.sandboxEnforcement,
    loop_control: config.loopControl,
    background: config.background,
    cache: config.cache,
    model_catalog: config.modelCatalog,
    telemetry: config.telemetry,
    raw: config.raw === undefined ? undefined : redactConfigRaw(config.raw),
  };
}

function hasProviderCredential(provider: ProviderConfig): boolean {
  if (nonEmpty(provider.apiKey) !== undefined) return true;
  if (provider.apiKeys?.length !== undefined && provider.apiKeys.length > 0) return true;
  if (provider.credentials?.length !== undefined && provider.credentials.length > 0) return true;
  if (provider.oauth !== undefined) return true;
  if (provider.oauths?.length !== undefined && provider.oauths.length > 0) return true;
  return false;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function redactConfigRaw(raw: Record<string, unknown>): Record<string, unknown> {
  return redactConfigValue(raw) as Record<string, unknown>;
}

function redactConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfigValue);
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    out[key] = isCredentialKey(key) ? '[redacted]' : redactConfigValue(entryValue);
  }
  return out;
}

function isCredentialKey(key: string): boolean {
  return /api[_-]?key|oauth|credential|access[_-]?token|refresh[_-]?token|secret|password/i.test(key);
}


registerSingleton(IConfigService, ConfigService, InstantiationType.Delayed);
