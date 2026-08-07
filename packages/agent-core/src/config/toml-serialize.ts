import {
  type BackgroundConfig,
  type BrowserUseConfig,
  type CacheConfig,
  type ComputerUseConfig,
  type AgentConfig,
  type ExtrasConfig,
  type ExperimentalConfig,
  type HookDefConfig,
  type LioraConfig,
  type LoopControl,
  type MemoryConfig,
  type MediaConfig,
  type McpConfig,
  type ModelCatalogConfig,
  type ModelAlias,
  type ModelAliasOverrides,
  type MoonshotServiceConfig,
  type OAuthRef,
  type PermissionConfig,
  type PersonaConfig,
  type ProviderConfig,
  type ResearchConfig,
  type ResearchContext7Config,
  type ResearchLocalSearchConfig,
  type ServicesConfig,
  type ThinkingConfig,
} from '#/config/schema';
import { camelToSnake } from './toml-keys';
import { cloneRecord, cloneUnknown, isPlainObject, setDefined } from './toml-utils';

export function configToTomlData(config: LioraConfig): Record<string, unknown> {
  const out = cloneRecord(config.raw);

  // Strip deprecated fields
  delete out['default_yolo'];
  delete out['defaultYolo'];
  delete out['defaultPermissionMode'];

  // Top-level scalar fields
  const scalarFields: (keyof LioraConfig)[] = [
    'defaultProvider',
    'defaultModel',
    'planMode',
    'yolo',
    'defaultThinking',
    'defaultPermissionMode',
    'defaultPlanMode',
    'mergeAllAvailableSkills',
    'extraSkillDirs',
    'skillSearchLimit',
    'skillSearchMaxLimit',
    'skillPromptMode',
    'telemetry',
  ];
  for (const key of scalarFields) {
    setDefined(out, camelToSnake(key), config[key]);
  }

  setRecordSection(out, 'providers', config.providers, providerToToml);
  setRecordSection(out, 'models', config.models, modelToToml);
  setSection(out, 'thinking', config.thinking, thinkingToToml);
  setSection(out, 'services', config.services, servicesToToml);
  setSection(out, 'loop_control', config.loopControl, loopControlToToml);
  setSection(out, 'background', config.background, backgroundToToml);
  setSection(out, 'media', config.media, mediaToToml);
  setSection(out, 'memory', config.memory, memoryToToml);
  setSection(out, 'cache', config.cache, cacheToToml);
  setSection(out, 'research', config.research, researchToToml);
  setSection(out, 'model_catalog', config.modelCatalog, modelCatalogToToml);
  setSection(out, 'browser_use', config.browserUse, browserUseToToml);
  setSection(out, 'computer_use', config.computerUse, computerUseToToml);
  setSection(out, 'mcp', config.mcp, mcpToToml);
  setSection(out, 'extras', config.extras, extrasToToml);
  setSection(out, 'persona', config.persona, personaToToml);
  setSection(out, 'agent', config.agent, agentToToml);
  setSection(out, 'experimental', config.experimental, experimentalToToml);
  setSection(out, 'permission', config.permission, permissionToToml);
  setHooks(out, config.hooks);

  return out;
}

function setRecordSection<T>(
  out: Record<string, unknown>,
  snakeKey: string,
  value: Record<string, T> | undefined,
  toToml: (v: T, raw: unknown) => Record<string, unknown>,
): void {
  if (value === undefined) {
    delete out[snakeKey];
    return;
  }

  const rawSub = cloneRecord(out[snakeKey]);
  const converted: Record<string, unknown> = {};
  for (const [entryName, entryConfig] of Object.entries(value)) {
    converted[entryName] = toToml(entryConfig, rawSub[entryName]);
  }

  if (Object.keys(converted).length > 0) {
    out[snakeKey] = converted;
  } else {
    delete out[snakeKey];
  }
}

function setSection<T>(
  out: Record<string, unknown>,
  snakeKey: string,
  value: T | undefined,
  toToml: (v: T, raw: unknown) => Record<string, unknown>,
): void {
  if (value === undefined) {
    delete out[snakeKey];
    return;
  }
  const rawSub = cloneRecord(out[snakeKey]);
  const converted = toToml(value, rawSub);
  if (Object.keys(converted).length > 0) {
    out[snakeKey] = converted;
  } else {
    delete out[snakeKey];
  }
}

function providerToToml(provider: ProviderConfig, rawProvider: unknown): Record<string, unknown> {
  const out = cloneRecord(rawProvider);
  for (const [key, value] of Object.entries(provider)) {
    if (key === 'oauth' && value !== undefined) {
      out[camelToSnake(key)] = oauthToToml(value as OAuthRef);
    } else if (key === 'oauths' && value !== undefined) {
      out[camelToSnake(key)] = (value as readonly OAuthRef[]).map(oauthToToml);
    } else if (key === 'credentials' && value !== undefined) {
      out[camelToSnake(key)] = (value as readonly Record<string, unknown>[]).map(
        plainObjectToToml,
      );
    } else if ((key === 'env' || key === 'customHeaders') && value !== undefined) {
      out[camelToSnake(key)] = cloneUnknown(value);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function modelToToml(model: ModelAlias, rawModel: unknown): Record<string, unknown> {
  const out = cloneRecord(rawModel);
  for (const [key, value] of Object.entries(model)) {
    if (key === 'capabilities' && Array.isArray(value)) {
      out[camelToSnake(key)] = [...value];
    } else if (key === 'routing' && value !== undefined) {
      out[camelToSnake(key)] = plainObjectToToml(
        value as Record<string, unknown>,
        out[camelToSnake(key)],
      );
    } else if (key === 'overrides' && isPlainObject(value)) {
      out[camelToSnake(key)] = modelOverridesToToml(
        value as ModelAliasOverrides,
        out[camelToSnake(key)],
      );
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function modelOverridesToToml(
  overrides: ModelAliasOverrides,
  rawOverrides: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawOverrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'cost' && isPlainObject(value)) {
      const cost = cloneRecord(out[camelToSnake(key)]);
      for (const [costKey, costValue] of Object.entries(value)) {
        setDefined(cost, costKey, costValue);
      }
      out[camelToSnake(key)] = cost;
    } else if (key === 'routing' && isPlainObject(value)) {
      out[camelToSnake(key)] = plainObjectToToml(value, out[camelToSnake(key)]);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function plainObjectToToml(
  value: Record<string, unknown>,
  rawValue?: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawValue);
  for (const [key, entryValue] of Object.entries(value)) {
    setDefined(out, camelToSnake(key), entryValue);
  }
  return out;
}

function thinkingToToml(thinking: ThinkingConfig, rawThinking: unknown): Record<string, unknown> {
  const out = cloneRecord(rawThinking);
  for (const [key, value] of Object.entries(thinking)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function permissionToToml(
  permission: PermissionConfig,
  rawPermission: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawPermission);
  delete out['deny'];
  delete out['allow'];
  delete out['ask'];

  if (permission.rules !== undefined) {
    out['rules'] = permission.rules.map(permissionRuleToToml);
  } else {
    delete out['rules'];
  }
  return out;
}

function permissionRuleToToml(
  rule: NonNullable<PermissionConfig['rules']>[number],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function servicesToToml(services: ServicesConfig, rawServices: unknown): Record<string, unknown> {
  const out = cloneRecord(rawServices);
  if (services.moonshotSearch !== undefined) {
    out['moonshot_search'] = serviceToToml(services.moonshotSearch);
  } else {
    delete out['moonshot_search'];
  }
  if (services.moonshotFetch !== undefined) {
    out['moonshot_fetch'] = serviceToToml(services.moonshotFetch);
  } else {
    delete out['moonshot_fetch'];
  }
  return out;
}

function serviceToToml(service: MoonshotServiceConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(service)) {
    if (key === 'oauth' && value !== undefined) {
      out[camelToSnake(key)] = oauthToToml(value as OAuthRef);
    } else if (key === 'customHeaders' && value !== undefined) {
      out[camelToSnake(key)] = cloneUnknown(value);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

const LOOP_CONTROL_MODEL_FIELDS = [
  'compactionModel',
  'completionModel',
  'explorationModel',
  'codingModel',
  'planningModel',
  'debuggingModel',
] as const satisfies readonly (keyof LoopControl)[];

function loopControlToToml(
  loopControl: LoopControl,
  rawLoopControl: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawLoopControl);
  for (const key of LOOP_CONTROL_MODEL_FIELDS) {
    if (loopControl[key] === undefined) {
      delete out[camelToSnake(key)];
    }
  }
  for (const [key, value] of Object.entries(loopControl)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function backgroundToToml(
  background: BackgroundConfig,
  rawBackground: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawBackground);
  for (const [key, value] of Object.entries(background)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function mediaToToml(media: MediaConfig, rawMedia: unknown): Record<string, unknown> {
  const out = cloneRecord(rawMedia);
  for (const [key, value] of Object.entries(media)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function mcpToToml(mcp: McpConfig, rawMcp: unknown): Record<string, unknown> {
  const out = cloneRecord(rawMcp);
  for (const [key, value] of Object.entries(mcp)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function extrasToToml(extras: ExtrasConfig, rawExtras: unknown): Record<string, unknown> {
  const out = cloneRecord(rawExtras);
  for (const [key, value] of Object.entries(extras)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function memoryToToml(memory: MemoryConfig, rawMemory: unknown): Record<string, unknown> {
  const out = cloneRecord(rawMemory);
  for (const [key, value] of Object.entries(memory)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function cacheToToml(cache: CacheConfig, rawCache: unknown): Record<string, unknown> {
  const out = cloneRecord(rawCache);
  for (const [key, value] of Object.entries(cache)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function researchToToml(research: ResearchConfig, rawResearch: unknown): Record<string, unknown> {
  const out = cloneRecord(rawResearch);
  for (const [key, value] of Object.entries(research)) {
    if (key === 'localSearch' && value !== undefined) {
      out['local_search'] = researchLocalSearchToToml(value as ResearchLocalSearchConfig);
    } else if (key === 'search' && value !== undefined) {
      out['search'] = researchSearchToToml(value as import('./schema').ResearchSearchConfig);
    } else if (key === 'context7' && value !== undefined) {
      out['context7'] = researchContext7ToToml(value as ResearchContext7Config);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function researchSearchToToml(search: import('./schema').ResearchSearchConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(search)) {
    if (key === 'providers' && Array.isArray(value)) {
      out['providers'] = value.map((entry) =>
        isPlainObject(entry) ? plainObjectToToml(entry as Record<string, unknown>) : entry,
      );
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function researchContext7ToToml(context7: ResearchContext7Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context7)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function researchLocalSearchToToml(localSearch: ResearchLocalSearchConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(localSearch)) {
    if (key === 'directSources' && value !== undefined) {
      out['direct_sources'] = plainObjectToToml(value as Record<string, unknown>);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function modelCatalogToToml(
  modelCatalog: ModelCatalogConfig,
  rawModelCatalog: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawModelCatalog);
  for (const [key, value] of Object.entries(modelCatalog)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function browserUseToToml(
  browserUse: BrowserUseConfig,
  rawBrowserUse: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawBrowserUse);
  for (const [key, value] of Object.entries(browserUse)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function computerUseToToml(
  computerUse: ComputerUseConfig,
  rawComputerUse: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawComputerUse);
  for (const [key, value] of Object.entries(computerUse)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function personaToToml(
  persona: PersonaConfig,
  rawPersona: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawPersona);
  for (const [key, value] of Object.entries(persona)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function agentToToml(agent: AgentConfig, rawAgent: unknown): Record<string, unknown> {
  const out = cloneRecord(rawAgent);
  for (const [key, value] of Object.entries(agent)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function experimentalToToml(
  experimental: ExperimentalConfig,
  _rawExperimental: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(experimental)) {
    setDefined(out, key, value);
  }
  return out;
}

function setHooks(out: Record<string, unknown>, hooks: readonly HookDefConfig[] | undefined): void {
  if (hooks === undefined) {
    delete out['hooks'];
    return;
  }
  out['hooks'] = hooks.map(hookToToml);
}

function hookToToml(hook: HookDefConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hook)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}

function oauthToToml(oauth: OAuthRef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(oauth)) {
    setDefined(out, camelToSnake(key), value);
  }
  return out;
}
