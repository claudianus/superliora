import { describe, expect, it } from 'vitest';

import { expandPluginPlaceholders } from '../../src/plugin/expand';
import {
  parseUserConfigSchema,
  resolveUserConfigValues,
  userConfigEnvVars,
} from '../../src/plugin/user-config';

describe('userConfig', () => {
  it('parses Claude field schema', () => {
    const diagnostics: Array<{ severity: string; message: string }> = [];
    const schema = parseUserConfigSchema(
      {
        apiKey: { type: 'string', sensitive: true, title: 'Key' },
        region: { type: 'string', default: 'eu' },
      },
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(schema?.['apiKey']?.sensitive).toBe(true);
    expect(schema?.['region']?.default).toBe('eu');
  });

  it('merges defaults with stored values and expands placeholders', () => {
    const values = resolveUserConfigValues(
      { region: { type: 'string', default: 'us' }, token: { type: 'string' } },
      { token: 'abc' },
    );
    expect(values).toEqual({ region: 'us', token: 'abc' });
    expect(userConfigEnvVars(values)).toEqual({
      CLAUDE_PLUGIN_OPTION_region: 'us',
      CLAUDE_PLUGIN_OPTION_token: 'abc',
    });
    expect(
      expandPluginPlaceholders('${user_config.token}@${CLAUDE_PLUGIN_ROOT}', {
        pluginRoot: '/p',
        pluginData: '/d',
        projectDir: '/c',
        userConfig: values,
      }),
    ).toBe('abc@/p');
  });
});
