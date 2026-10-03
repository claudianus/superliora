import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configToTomlData, ensureConfigFile, loadRuntimeConfigSafe, mergeConfigPatch,
  parseConfigString, readConfigFileForUpdate, validateConfig, writeConfigFile,
} from '../../src/config';
import { LioraError } from '../../src/errors';
import type { LioraConfigPatch } from '../../src/config';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function configPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-native-config-'));
  tempDirs.push(dir);
  return join(dir, 'config.toml');
}

const NATIVE_TOML = `
default_provider = "native-provider"
default_model = "native-model"
default_permission_mode = "manual"
sandbox_profile = "workspace"
sandbox_enforcement = "process"
telemetry = false
[providers.native-provider]
type = "openai"
api_keys = ["first", "second"]
default_model = "wire-model"
[providers.native-provider.custom_headers]
X_Custom_Header = "verbatim"
[providers.native-provider.env]
API_ENV_VAR = "verbatim"
[providers.native-provider.source]
source_key = "verbatim"
[[providers.native-provider.credentials]]
api_key = "third"
base_url = "https://example.com/v1"
rpm = 5
[[providers.native-provider.oauths]]
storage = "file"
key = "auth"
oauth_host = "https://example.com"
[models.native-model]
provider = "native-provider"
model = "wire-model"
max_context_size = 32768
max_output_size = 4096
capabilities = ["thinking"]
support_efforts = ["low", "high"]
default_effort = "low"
fallback_models = ["fallback-model"]
[models.native-model.cost]
input = 1.5
cache_read = 0.1
[models.native-model.routing]
strategy = "round_robin"
preferred_credential = "third"
[models.native-model.routing.weights]
native-model = 2
fallback-model = 1
[models.native-model.overrides]
max_output_size = 2048
[models.fallback-model]
provider = "native-provider"
model = "fallback-wire"
max_context_size = 16384
[thinking]
mode = "on"
effort = "high"
[permission]
[[permission.rules]]
decision = "ask"
scope = "project"
pattern = "Bash(git push*)"
[loop_control]
max_steps_per_turn = 9
[background]
max_running_tasks = 3
kill_grace_period_ms = 1000
[cache]
invalidate_epoch = 2
[model_catalog]
refresh_interval_ms = 3600000
refresh_on_start = true
`;

describe('native config TOML', () => {
  it('round-trips native auth, model metadata, transport, sandbox and runtime settings', async () => {
    const path = await configPath();
    const parsed = parseConfigString(NATIVE_TOML);
    expect(parsed.providers['native-provider']?.credentials?.[0]?.apiKey).toBe('third');
    expect(parsed.models?.['native-model']?.routing?.weights).toEqual({ 'native-model': 2, 'fallback-model': 1 });
    await writeConfigFile(path, parsed);
    const text = await readFile(path, 'utf-8');
    expect(configToTomlData(parseConfigString(text))).toEqual(configToTomlData(parsed));
    expect(text).toContain('X_Custom_Header');
    expect(text).toContain('API_ENV_VAR');
    expect(text).toContain('cache_read');
  });

  it('rejects retired cognitive sections and scalar controls', () => {
    for (const text of [
      'plan_mode = true', 'free_mode = true', 'merge_all_available_skills = true',
      'extra_skill_dirs = ["skills"]', '[memory]\nenabled = true',
      '[research]\nenabled = true', '[persona]\nname = "guide"',
      '[mcp]\nauto_provider_servers = true', '[plugin]\nenabled = true',
      '[context_os]\nenabled = true', '[experimental]\nauto_compaction = true',
      '[goals]\nenabled = true', '[quality]\nenabled = true',
      '[refine]\nenabled = true', '[dream]\nenabled = true',
      '[[hooks]]\nevent = "Stop"\ncommand = "echo retired"',
    ]) expect(() => parseConfigString(text)).toThrow(LioraError);
  });

  it('rejects retired loop controls and aliases rather than ignoring them', () => {
    for (const field of ['max_retries_per_step', 'max_ralph_iterations', 'reserved_context_size', 'compaction_trigger_ratio',
      'compaction_model', 'coding_model', 'worker_inherit_parent', 'smart_router_budget_usd',
      'max_steps_per_run', 'auto_continue']) {
      expect(() => parseConfigString(`[loop_control]\n${field} = 1`)).toThrow(LioraError);
    }
    expect(validateConfig({ providers: {} }).loopControl).toBeUndefined();
    expect(parseConfigString('[loop_control]\nmax_steps_per_turn = 0').loopControl?.maxStepsPerTurn).toBe(0);
  });

  it('rejects unknown nested config fields and invalid native metadata', () => {
    expect(() => parseConfigString('[background]\nauto_continue = true')).toThrow(LioraError);
    expect(() => parseConfigString('[background]\nkeep_alive_on_exit = true')).toThrow(LioraError);
    expect(() => parseConfigString('[models.native]\nprovider = "p"\nmodel = "m"')).toThrow(/max_context_size/);
    expect(() => parseConfigString('[loop_control]\nmax_steps_per_turn = -1')).toThrow(LioraError);
    expect(() => parseConfigString('[permission]\n[[permission.rules]]\ndecision = "allow"\npattern = ""')).toThrow(LioraError);
  });

  it('preserves unrelated raw configuration without serializing retired fields', () => {
    const data = configToTomlData({ providers: {}, raw: { memory: { enabled: true }, theme: 'dark' } });
    expect(data).toEqual({ theme: 'dark' });
  });

  it('preserves custom sections and model names that match retired section names', () => {
    const config = parseConfigString(`
[custom_section]
user_key = "preserved"
[providers.memory]
type = "openai"
api_key = "test-key"
custom_provider_field = true
[models.agent]
provider = "memory"
model = "native-model"
max_context_size = 128000
custom_model_field = true
`);
    expect(configToTomlData(config)).toMatchObject({
      custom_section: { user_key: 'preserved' },
      providers: { memory: { custom_provider_field: true } },
      models: { agent: { custom_model_field: true } },
    });
    expect(() => validateConfig({ providers: {}, customSection: {} })).toThrow(LioraError);
  });

  it('creates an empty readable file without overwriting existing config', async () => {
    const path = await configPath();
    await ensureConfigFile(path);
    expect(parseConfigString(await readFile(path, 'utf-8')).providers).toEqual({});
    await writeFile(path, NATIVE_TOML);
    await ensureConfigFile(path);
    expect(await readFile(path, 'utf-8')).toBe(NATIVE_TOML);
  });

  it('reports unsupported config as an explicit runtime file error', async () => {
    const path = await configPath();
    await writeFile(path, '[memory]\nenabled = true');
    const result = loadRuntimeConfigSafe(path, {});
    expect(result.fileError).toBeInstanceOf(LioraError);
    expect(result.fileWarnings.length).toBeGreaterThan(0);
    expect(() => readConfigFileForUpdate(path)).toThrow(LioraError);
  });
});

describe('native config patch merge', () => {
  it('merges native sections without losing provider credentials or model metadata', () => {
    const config = parseConfigString(NATIVE_TOML);
    const merged = mergeConfigPatch(config, {
      providers: { 'native-provider': { baseUrl: 'https://new.example/v1' } },
      models: { 'native-model': { maxOutputSize: 8192 } },
      loopControl: { maxStepsPerTurn: 12 },
      cache: { invalidateEpoch: 3 },
    });
    expect(merged.providers['native-provider']?.credentials).toEqual(config.providers['native-provider']?.credentials);
    expect(merged.models?.['native-model']?.maxOutputSize).toBe(8192);
    expect(merged.models?.['native-model']?.model).toBe('wire-model');
    expect(merged.loopControl).toEqual({ maxStepsPerTurn: 12 });
  });

  it('rejects retired patch fields at top level and inside native sections', () => {
    for (const patch of [{ memory: {} }, { loopControl: { codingModel: 'native-model' } },
      { background: { autoContinue: true } }]) {
      expect(() => mergeConfigPatch({ providers: {} }, patch as LioraConfigPatch)).toThrow(LioraError);
    }
  });
});
