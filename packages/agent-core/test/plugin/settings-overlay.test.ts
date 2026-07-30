import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadPluginSettingsOverlay } from '../../src/plugin/settings-overlay';

describe('loadPluginSettingsOverlay', () => {
  it('maps allowlisted keys and rejects providers/keys', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'settings-overlay-'));
    const settingsPath = path.join(dir, 'settings.json');
    await writeFile(
      settingsPath,
      JSON.stringify({
        env: { PLUGIN_FLAG: '1' },
        providers: { bad: {} },
        defaultModel: 'secret',
        permissions: [
          { pattern: 'Bash(*)', decision: 'deny', reason: 'no shell' },
        ],
        loopControl: { maxStepsPerTurn: 12 },
        telemetry: false,
      }),
      'utf8',
    );

    const overlay = await loadPluginSettingsOverlay(settingsPath);
    expect(overlay.env).toEqual({ PLUGIN_FLAG: '1' });
    expect(overlay.patch.loopControl).toEqual({ maxStepsPerTurn: 12 });
    expect(overlay.patch.telemetry).toBe(false);
    expect(overlay.patch.permission?.rules).toEqual([
      {
        pattern: 'Bash(*)',
        decision: 'deny',
        scope: 'session-runtime',
        reason: 'no shell',
      },
    ]);
    expect(overlay.diagnostics.some((d) => d.message.includes('providers'))).toBe(true);
    expect(overlay.diagnostics.some((d) => d.message.includes('defaultModel'))).toBe(true);
  });
});
