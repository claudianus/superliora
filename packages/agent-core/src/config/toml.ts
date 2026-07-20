import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'pathe';

import { ErrorCodes, LioraError } from '#/errors';
import { applyEnvModelConfig, stripEnvModelConfig } from './env-model';
import {
  LioraConfigSchema,
  formatConfigValidationError,
  getDefaultConfig,
  type BackgroundConfig,
  type BrowserUseConfig,
  type ComputerUseConfig,
  type ExperimentalConfig,
  type HookDefConfig,
  type LioraConfig,
  type LoopControl,
  type MemoryConfig,
  type ModelCatalogConfig,
  type ModelAlias,
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
  validateConfig,
} from '#/config/schema';
import { atomicWrite } from '#/utils/fs';
import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';

/* ------------------------------------------------------------------ */
/*  Key helpers – reuse generic snake / camel conversion instead of    */
/*  maintaining per-section *_KEY_MAP tables.                         */
/* ------------------------------------------------------------------ */

function snakeToCamel(str: string): string {
  return str.replaceAll(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function camelToSnake(str: string): string {
  return str.replaceAll(/[A-Z]/g, (ch: string) => `_${ch.toLowerCase()}`);
}

/* ------------------------------------------------------------------ */
/*  Read / parse                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG_FILE_TEXT = `# ~/.superliora/config.toml
# Runtime settings for SuperLiora.
# This file starts empty so built-in defaults can apply.
# Login will populate managed Kimi provider and model entries.
#
# Product telemetry is off by default (ZDR-friendly).
# Set telemetry = true only if you want usage analytics.
# telemetry = false
`;

export async function ensureConfigFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, 'wx', 0o600);
    await handle.writeFile(DEFAULT_CONFIG_FILE_TEXT, 'utf-8');
  } catch (error) {
    if (isFileExistsError(error)) return;
    throw error;
  } finally {
    await handle?.close();
  }
}

export function readConfigFile(filePath: string): LioraConfig {
  if (!existsSync(filePath)) {
    return getDefaultConfig();
  }
  const text = readFileSync(filePath, 'utf-8');
  return parseConfigString(text, filePath);
}

/**
 * Strict read for write paths (read-merge-write must never use a salvaged
 * config as its base, or the rewrite would drop the user's broken-but-fixable
 * sections). Re-throws validation failures with a short actionable message —
 * UIs surface it directly — instead of the raw validation details.
 */
export function readConfigFileForUpdate(filePath: string): LioraConfig {
  try {
    return readConfigFile(filePath);
  } catch (error) {
    if (error instanceof LioraError && error.code === ErrorCodes.CONFIG_INVALID) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Cannot change settings while ${filePath} is invalid — fix it first (run \`liora doctor\` for details).`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Load the config for runtime consumption: the on-disk config plus any model
 * synthesized from `KIMI_MODEL_*` environment variables. Use this everywhere a
 * value is assigned to the live runtime config; use the raw `readConfigFile`
 * for write-back paths so the synthesized model is never persisted.
 */
export function loadRuntimeConfig(
  filePath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LioraConfig {
  return applyEnvModelConfig(readConfigFile(filePath), env);
}

export interface RuntimeConfigLoadResult {
  readonly config: LioraConfig;
  /** Problems in config.toml itself; non-empty means parts (or all) of the file were ignored. */
  readonly fileWarnings: readonly string[];
  /** Problems applying KIMI_MODEL_* env overrides; the overlay was skipped. */
  readonly envWarnings: readonly string[];
  /**
   * Set when the file is entirely unusable (unreadable, TOML syntax error, or
   * nothing salvageable) and `config` is pure defaults. Startup fails fast on
   * this — defaults-only means the user looks logged out, which is worse than
   * an actionable parse error. Mid-run reloads ignore it and keep the last
   * good config instead.
   */
  readonly fileError?: LioraError;
}

/**
 * Lenient variant of `loadRuntimeConfig` that never throws: schema errors
 * drop only the offending sections (whole entry for `providers`/`models`,
 * whole top-level section otherwise) and a bad KIMI_MODEL_* env overlay is
 * skipped, each reported as a warning. A file that cannot be used at all
 * additionally sets `fileError` so startup can fail fast while mid-run
 * reloads degrade. Runtime read paths use this; write paths must keep using
 * the strict readers so a broken file is never silently rewritten.
 */
export function loadRuntimeConfigSafe(
  filePath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfigLoadResult {
  const fileWarnings: string[] = [];
  let fileError: LioraError | undefined;
  let config = getDefaultConfig();

  let text: string | undefined;
  try {
    text = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined;
  } catch (error) {
    fileError = new LioraError(
      ErrorCodes.CONFIG_INVALID,
      `Failed to read ${filePath}: ${describeUnknownError(error)}`,
      { cause: error },
    );
    fileWarnings.push(`Failed to read ${filePath}: ${describeUnknownError(error)}.`);
  }

  if (text !== undefined && text.trim().length > 0) {
    let data: Record<string, unknown> | undefined;
    try {
      data = parseToml(text) as Record<string, unknown>;
    } catch (error) {
      // Same message as the strict parser, code frame included, so failing
      // startup points straight at the offending line.
      fileError = new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Invalid TOML in ${filePath}: ${describeUnknownError(error)}`,
        { cause: error },
      );
      fileWarnings.push(`Invalid TOML in ${filePath}: ${describeTomlSyntaxError(error)}.`);
    }
    if (data !== undefined) {
      const raw = cloneRecord(data);
      const transformed = transformTomlData(data);
      transformed['raw'] = raw;
      const salvaged = salvageConfigData(transformed);
      if (salvaged.config === undefined) {
        fileError = new LioraError(
          ErrorCodes.CONFIG_INVALID,
          `Invalid configuration in ${filePath}: ${formatConfigValidationError(salvaged.error)}`,
          { cause: salvaged.error },
        );
        fileWarnings.push(
          `Invalid configuration in ${filePath}: ${formatConfigValidationError(salvaged.error)}.`,
        );
      } else {
        config = salvaged.config;
        if (salvaged.dropped.length > 0) {
          fileWarnings.push(
            `Ignored invalid config in ${filePath}: ${salvaged.dropped.join(', ')}. Run \`liora doctor\` for details.`,
          );
        }
      }
    }
  }

  const envWarnings: string[] = [];
  try {
    config = applyEnvModelConfig(config, env);
  } catch (error) {
    envWarnings.push(
      `Ignoring KIMI_MODEL_* environment overrides: ${describeUnknownError(error)}`,
    );
  }

  return { config, fileWarnings, envWarnings, fileError };
}

/** Sections keyed by user-chosen names where single entries can be dropped. */
const ENTRY_KEYED_SECTIONS = new Set(['providers', 'models']);

interface SalvageResult {
  readonly config: LioraConfig | undefined;
  readonly dropped: readonly string[];
  readonly error?: unknown;
}

function salvageConfigData(transformed: Record<string, unknown>): SalvageResult {
  const dropped: string[] = [];
  for (;;) {
    const result = LioraConfigSchema.safeParse(transformed);
    if (result.success) {
      return { config: result.data, dropped };
    }
    let deletedAny = false;
    for (const issue of result.error.issues) {
      const [section, entry] = issue.path;
      if (typeof section !== 'string' || !(section in transformed)) continue;
      const sectionValue = transformed[section];
      if (
        ENTRY_KEYED_SECTIONS.has(section) &&
        typeof entry === 'string' &&
        isPlainObject(sectionValue)
      ) {
        // Issues on entry-keyed sections only ever drop that entry. An entry
        // with several issues is deleted by the first one; later issues are
        // no-ops and must not escalate to deleting the whole section.
        if (entry in sectionValue) {
          delete sectionValue[entry];
          dropped.push(`${camelToSnake(section)}.${entry}`);
          deletedAny = true;
        }
        continue;
      }
      delete transformed[section];
      dropped.push(camelToSnake(section));
      deletedAny = true;
    }
    if (!deletedAny) {
      return { config: undefined, dropped, error: result.error };
    }
  }
}

function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One-line summary of a smol-toml parse error: first message line plus the
 * line/column location, without the multi-line code-frame block.
 */
function describeTomlSyntaxError(error: unknown): string {
  const firstLine = describeUnknownError(error).split('\n', 1)[0] ?? '';
  if (error instanceof TomlError) {
    return `${firstLine} (line ${error.line}, column ${error.column})`;
  }
  return firstLine;
}

export function parseConfigString(tomlText: string, filePath = 'config.toml'): LioraConfig {
  if (tomlText.trim().length === 0) {
    return getDefaultConfig();
  }

  let data: Record<string, unknown>;
  try {
    data = parseToml(tomlText) as Record<string, unknown>;
  } catch (error) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid TOML in ${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  return parseConfigData(data, filePath);
}

function parseConfigData(data: Record<string, unknown>, filePath: string): LioraConfig {
  const raw = cloneRecord(data);
  const transformed = transformTomlData(data);
  transformed['raw'] = raw;

  try {
    return LioraConfigSchema.parse(transformed);
  } catch (error) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, `Invalid configuration in ${filePath}: ${formatConfigValidationError(error)}`, {
      cause: error,
    });
  }
}

export function transformTomlData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);

    if (targetKey === 'providers' && isPlainObject(value)) {
      result[targetKey] = transformRecord(value, transformProviderData);
    } else if (targetKey === 'models' && isPlainObject(value)) {
      result[targetKey] = transformRecord(value, transformModelData);
    } else if (targetKey === 'thinking' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'permission' && isPlainObject(value)) {
      result[targetKey] = transformPermissionData(value);
    } else if (targetKey === 'services' && isPlainObject(value)) {
      result[targetKey] = transformRecord(value, transformServiceData, snakeToCamel);
    } else if (targetKey === 'loopControl' && isPlainObject(value)) {
      result[targetKey] = transformLoopControlData(value);
    } else if (targetKey === 'background' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'memory' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'research' && isPlainObject(value)) {
      result[targetKey] = transformResearchData(value);
    } else if (targetKey === 'modelCatalog' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'browserUse' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'computerUse' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'persona' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'experimental' && isPlainObject(value)) {
      result[targetKey] = cloneRecord(value);
    } else if (!isPlainObject(value)) {
      result[targetKey] = value;
    }
  }
  return result;
}

function transformRecord(
  value: Record<string, unknown>,
  transformEntry: (entry: Record<string, unknown>) => Record<string, unknown>,
  transformName: (name: string) => string = (name) => name,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [entryName, entryConfig] of Object.entries(value)) {
    record[transformName(entryName)] = isPlainObject(entryConfig)
      ? transformEntry(entryConfig)
      : entryConfig;
  }
  return record;
}

function transformPlainObject(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[snakeToCamel(key)] = value;
  }
  return out;
}

function transformProviderData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);
    if (targetKey === 'oauth') {
      out[targetKey] = isPlainObject(value) ? transformPlainObject(value) : value;
    } else if (targetKey === 'oauths' || targetKey === 'credentials') {
      out[targetKey] = Array.isArray(value)
        ? value.map((entry) => (isPlainObject(entry) ? transformPlainObject(entry) : entry))
        : value;
    } else if (targetKey === 'env' || targetKey === 'customHeaders') {
      out[targetKey] = cloneObjectValue(value);
    } else {
      out[targetKey] = value;
    }
  }
  return out;
}

function transformModelData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (isPlainObject(out['routing'])) {
    out['routing'] = transformPlainObject(out['routing']);
  }
  return out;
}

function transformPermissionData(data: Record<string, unknown>): Record<string, unknown> {
  const raw = transformPlainObject(data);
  const out: Record<string, unknown> = {};

  const rules: unknown[] = [];
  appendPermissionRules(rules, raw['rules']);
  appendPermissionRules(rules, raw['deny'], 'deny');
  appendPermissionRules(rules, raw['allow'], 'allow');
  appendPermissionRules(rules, raw['ask'], 'ask');
  if (rules.length > 0) {
    out['rules'] = rules;
  }
  return out;
}

function appendPermissionRules(
  target: unknown[],
  value: unknown,
  decision?: 'allow' | 'deny' | 'ask',
): void {
  if (value === undefined) return;
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    target.push(transformPermissionRule(entry, decision));
  }
}

function transformPermissionRule(value: unknown, decision?: 'allow' | 'deny' | 'ask'): unknown {
  if (!isPlainObject(value)) return value;

  const rule = transformPlainObject(value);
  const tool = rule['tool'];
  const match = rule['match'];
  const pattern = rule['pattern'];
  const out: Record<string, unknown> = {};

  if (decision !== undefined) {
    out['decision'] = decision;
  } else {
    out['decision'] = rule['decision'];
  }
  out['scope'] = rule['scope'];
  out['reason'] = rule['reason'];

  if (typeof tool === 'string') {
    const argPattern = typeof match === 'string' ? match : pattern;
    out['pattern'] = typeof argPattern === 'string' ? `${tool}(${argPattern})` : tool;
  } else {
    out['pattern'] = pattern;
  }

  return out;
}

function transformServiceData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);
    if (targetKey === 'oauth') {
      out[targetKey] = isPlainObject(value) ? transformPlainObject(value) : value;
    } else if (targetKey === 'customHeaders') {
      out[targetKey] = cloneObjectValue(value);
    } else {
      out[targetKey] = value;
    }
  }
  return out;
}

function transformLoopControlData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (out['maxStepsPerTurn'] === undefined && out['maxStepsPerRun'] !== undefined) {
    out['maxStepsPerTurn'] = out['maxStepsPerRun'];
  }
  delete out['maxStepsPerRun'];
  return out;
}

function transformResearchData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (isPlainObject(out['localSearch'])) {
    out['localSearch'] = transformResearchLocalSearchData(out['localSearch']);
  }
  if (isPlainObject(out['search'])) {
    out['search'] = transformResearchSearchData(out['search']);
  }
  if (isPlainObject(out['context7'])) {
    out['context7'] = transformPlainObject(out['context7']);
  }
  return out;
}

function transformResearchSearchData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (Array.isArray(out['providers'])) {
    out['providers'] = out['providers'].map((entry) =>
      isPlainObject(entry) ? transformPlainObject(entry) : entry,
    );
  }
  return out;
}

function transformResearchLocalSearchData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (isPlainObject(out['directSources'])) {
    out['directSources'] = transformPlainObject(out['directSources']);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Write / stringify                                                  */
/* ------------------------------------------------------------------ */

export async function writeConfigFile(filePath: string, config: LioraConfig): Promise<void> {
  // Final guard: never persist the env-synthesized model/provider to disk,
  // even if a caller passes back the runtime config as a patch (see
  // stripEnvModelConfig / the getConfig -> setConfig round-trip).
  const validated = validateConfig(stripEnvModelConfig(config));
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await atomicWrite(filePath, `${stringifyToml(configToTomlData(validated))}\n`);
}

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
  setSection(out, 'memory', config.memory, memoryToToml);
  setSection(out, 'research', config.research, researchToToml);
  setSection(out, 'model_catalog', config.modelCatalog, modelCatalogToToml);
  setSection(out, 'browser_use', config.browserUse, browserUseToToml);
  setSection(out, 'computer_use', config.computerUse, computerUseToToml);
  setSection(out, 'persona', config.persona, personaToToml);
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
      out[camelToSnake(key)] = plainObjectToToml(value as Record<string, unknown>);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

function plainObjectToToml(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
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

function loopControlToToml(
  loopControl: LoopControl,
  rawLoopControl: unknown,
): Record<string, unknown> {
  const out = cloneRecord(rawLoopControl);
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

function memoryToToml(memory: MemoryConfig, rawMemory: unknown): Record<string, unknown> {
  const out = cloneRecord(rawMemory);
  for (const [key, value] of Object.entries(memory)) {
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

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  return cloneUnknown(value);
}

function cloneUnknown<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneObjectValue(value: unknown): unknown {
  return isPlainObject(value) ? cloneUnknown(value) : value;
}

function setDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  } else {
    delete target[key];
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}
