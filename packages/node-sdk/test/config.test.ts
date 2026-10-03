import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLioraConfigRpc, createLioraHarness, LioraError } from '#/index';

import {
  parseConfigString,
  readConfigFile,
  writeConfigFile,
} from '../../agent-core/src/config';
import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kimi-sdk-config-'));
  tempDirs.push(dir);
  return dir;
}

const COMPLETE_TOML = `
default_model = "kimi-for-coding"
default_thinking = false
default_permission_mode = "auto"
default_editor = ""
theme = "dark"
show_thinking_stream = true

[providers.kimi-for-coding]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "sk-xxx"
oauth = { storage = "file", key = "oauth/primary" }
custom_headers = { "X-Custom-Header" = "value" }

[providers.kimi-for-coding.env]
GOOGLE_CLOUD_PROJECT = "project-1"

[[providers.kimi-for-coding.oauths]]
storage = "file"
key = "oauth/backup"

[models.kimi-for-coding]
provider = "kimi-for-coding"
model = "kimi-for-coding"
max_context_size = 262144
capabilities = ["image_in", "thinking", "video_in"]
display_name = "Kimi for Coding"

[background]
max_running_tasks = 4
kill_grace_period_ms = 2000
print_wait_ceiling_s = 3600

[notifications]
claim_stale_after_ms = 15000
`;

describe('SDK config TOML', () => {
  it('returns structured validation issues through the config RPC wrapper', async () => {
    const rpc = createLioraConfigRpc();

    await expect(
      rpc.validateConfigToml({
        text: `
[providers.kimi]
type = "kimi"

[models.kimi]
provider = "kimi"
model = "kimi"
max_context_size = "large"
`,
        filePath: 'broken.toml',
      }),
    ).rejects.toMatchObject({
      details: {
        validationIssues: [
          {
            path: ['models', 'kimi', 'maxContextSize'],
          },
        ],
      },
    });
  });

  it('parses the documented config shape and keeps TUI-only fields in raw', () => {
    const config = parseConfigString(COMPLETE_TOML, 'complete.toml');

    expect(config.defaultModel).toBe('kimi-for-coding');
    expect(config.defaultThinking).toBe(false);
    expect(config.defaultPermissionMode).toBe('auto');

    const provider = config.providers['kimi-for-coding'];
    expect(provider).toMatchObject({
      type: 'kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      apiKey: 'sk-xxx',
      oauth: { storage: 'file', key: 'oauth/primary' },
      oauths: [{ storage: 'file', key: 'oauth/backup' }],
      customHeaders: { 'X-Custom-Header': 'value' },
      env: { GOOGLE_CLOUD_PROJECT: 'project-1' },
    });

    expect(config.models?.['kimi-for-coding']).toMatchObject({
      provider: 'kimi-for-coding',
      model: 'kimi-for-coding',
      maxContextSize: 262144,
      capabilities: ['image_in', 'thinking', 'video_in'],
      displayName: 'Kimi for Coding',
    });

    expect(config.background).toMatchObject({
      maxRunningTasks: 4,
      killGracePeriodMs: 2000,
      printWaitCeilingS: 3600,
    });

    expect('theme' in config).toBe(false);
    expect(config.raw?.['theme']).toBe('dark');
    expect(config.raw?.['show_thinking_stream']).toBe(true);
    expect(config.raw?.['notifications']).toEqual({ claim_stale_after_ms: 15000 });
  });

  it('writes typed fields in snake_case and preserves unknown raw sections', async () => {
    const dir = await makeTempDir();
    const configPath = join(dir, 'config.toml');
    const config = parseConfigString(COMPLETE_TOML, configPath);

    await writeConfigFile(configPath, {
      ...config,
      defaultModel: 'kimi-for-coding',
      loopControl: {
        ...config.loopControl,
        maxStepsPerTurn: 42,
      },
    });

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "kimi-for-coding"');
    expect(text).toContain('default_permission_mode = "auto"');
    expect(text).toContain('[[providers.kimi-for-coding.oauths]]');
    expect(text).toContain('key = "oauth/backup"');
    expect(text).not.toContain('default_yolo');
    expect(text).toContain('max_steps_per_turn = 42');
    expect(text).toContain('display_name = "Kimi for Coding"');
    expect(text).toContain('GOOGLE_CLOUD_PROJECT = "project-1"');
    expect(text).toContain('claim_stale_after_ms = 15000');
    expect(text).toContain('theme = "dark"');

    const reloaded = readConfigFile(configPath);
    expect(reloaded.loopControl?.maxStepsPerTurn).toBe(42);
    expect(reloaded.raw?.['theme']).toBe('dark');
  });

  it('accepts camelCase aliases without keeping unknown fields in typed config', () => {
    const config = parseConfigString(`
defaultModel = "camel-model"

[providers.local]
type = "openai"
baseUrl = "https://example.test/v1"
apiKey = "sk-test"
unsupported_provider_field = "raw-only"

[models.camel-model]
provider = "local"
model = "gpt-test"
maxContextSize = 128000
displayName = "Camel Model"
custom_model_field = "raw-only"

[loopControl]
maxStepsPerTurn = 7

[background]
maxRunningTasks = 2
`);

    expect(config.defaultModel).toBe('camel-model');
    expect(config.providers['local']).toMatchObject({
      type: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
    });
    expect(config.models?.['camel-model']).toMatchObject({
      maxContextSize: 128000,
      displayName: 'Camel Model',
    });
    expect(config.loopControl?.maxStepsPerTurn).toBe(7);
    expect(config.background?.maxRunningTasks).toBe(2);

    expect('unsupportedProviderField' in config.providers['local']!).toBe(false);
    expect('customModelField' in config.models!['camel-model']!).toBe(false);

    const rawProviders = config.raw?.['providers'] as Record<string, Record<string, unknown>>;
    const rawModels = config.raw?.['models'] as Record<string, Record<string, unknown>>;
    expect(rawProviders['local']?.['unsupported_provider_field']).toBe('raw-only');
    expect(rawModels['camel-model']?.['custom_model_field']).toBe('raw-only');
  });
});

describe('LioraHarness config API', () => {
  it('deep-merges provider patches from disk while preserving unknown fields', async () => {
    const homeDir = await makeTempDir();
    const configPath = join(homeDir, 'config.toml');
    await writeFile(configPath, COMPLETE_TOML, 'utf-8');

    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    await harness.setConfig({
      providers: {
        'kimi-for-coding': {
          apiKey: 'sk-updated',
        },
      },
    });

    const config = await harness.getConfig({ reload: true });
    expect(config.providers['kimi-for-coding']).toMatchObject({
      type: 'kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      apiKey: 'sk-updated',
      env: { GOOGLE_CLOUD_PROJECT: 'project-1' },
    });
    expect(config.raw?.['theme']).toBe('dark');

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('theme = "dark"');
    expect(text).toContain('GOOGLE_CLOUD_PROJECT = "project-1"');
    expect(text).toContain('claim_stale_after_ms = 15000');
  });

  it('round-trips newly persisted sections through the harness API', async () => {
    const homeDir = await makeTempDir();
    const configPath = join(homeDir, 'config.toml');
    await writeFile(
      configPath,
      `
[models.k2]
provider = "kimi"
model = "kimi-k2"
max_context_size = 128000

[models.k2.overrides]
display_name = "K2"
future_override = true


`,
      'utf-8',
    );
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    await harness.setConfig({
      models: { k2: { overrides: { displayName: 'K2 patched' } } },
    });

    const config = await harness.getConfig({ reload: true });
    expect(config.models?.['k2']?.overrides).toMatchObject({
      displayName: 'K2 patched',
    });
    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('future_override = true');
  });


  it('does not write invalid config patches', async () => {
    const homeDir = await makeTempDir();
    const configPath = join(homeDir, 'config.toml');
    await writeFile(configPath, COMPLETE_TOML, 'utf-8');
    const before = await readFile(configPath, 'utf-8');

    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    const setInvalidConfig = harness.setConfig({
      providers: {
        bad: {
          type: 'not-a-provider',
        },
      },
    } as never);

    await expect(setInvalidConfig).rejects.toBeInstanceOf(LioraError);
    await expect(setInvalidConfig).rejects.toMatchObject({
      code: 'config.invalid',
    } satisfies Partial<LioraError>);

    await expect(readFile(configPath, 'utf-8')).resolves.toBe(before);
  });

  it('reloads an active session without closing the SDK session wrapper', async () => {
    const homeDir = await makeTempDir();
    const workDir = join(homeDir, 'work');
    const configPath = join(homeDir, 'config.toml');
    await writeFile(configPath, COMPLETE_TOML, 'utf-8');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });
    const session = await harness.createSession({
      id: 'session-sdk-reload',
      workDir,
      model: 'kimi-for-coding',
    });

    expect(session.getResumeState()).toBeUndefined();

    const reloaded = await harness.reloadSession({ id: session.id });

    expect(reloaded).toBe(session);
    expect(harness.getSession(session.id)).toBe(session);
    expect(session.getResumeState()?.agents['main']).toBeDefined();
    await expect(session.getStatus()).resolves.toMatchObject({ model: 'kimi-for-coding' });
  });

});
