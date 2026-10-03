import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLioraHarness } from '@superliora/sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

async function main(): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'kimi-harness-config-home-'));
  const harness = createLioraHarness({ homeDir, identity: smokeIdentityFromEnv() });

  const initial = await harness.getConfig();
  if (Object.keys(initial.providers).length > 0) {
    throw new Error('expected empty providers for a fresh config home');
  }

  await harness.setConfig({
    defaultModel: 'kimi-code/kimi-for-coding',
    defaultThinking: true,
    defaultPermissionMode: 'manual',
    providers: {
      'managed:kimi-api': {
        type: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
    },
    models: {
      'kimi-code/kimi-for-coding': {
        provider: 'managed:kimi-api',
        model: 'kimi-for-coding',
        maxContextSize: 262144,
        capabilities: ['image_in', 'thinking', 'video_in'],
        displayName: 'Kimi for Coding',
      },
    },
  });

  const configPath = join(homeDir, 'config.toml');
  const text = await readFile(configPath, 'utf-8');
  for (const expected of [
    'default_model = "kimi-code/kimi-for-coding"',
    'default_permission_mode = "manual"',
    '[providers."managed:kimi-api"]',
    '[providers."managed:kimi-api".oauth]',
    '[models."kimi-code/kimi-for-coding"]',
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`missing ${expected} in written config`);
    }
  }

  const reloaded = await harness.getConfig({ reload: true });
  if (reloaded.defaultModel !== 'kimi-code/kimi-for-coding') {
    throw new Error('reloaded config did not preserve defaultModel');
  }
  if (reloaded.providers['managed:kimi-api']?.oauth?.key !== 'oauth/kimi-code') {
    throw new Error('reloaded config did not preserve provider oauth');
  }

  process.stdout.write(`config: ${configPath}\n`);
  process.stdout.write('ok\n');
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
