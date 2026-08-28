import { describe, expect, it } from 'vitest';

import { catalogApiKeyDialogState } from '#/tui/commands/auth/prompts';
import type { ProviderCatalogOption } from '#/tui/utils/model/provider-catalog-options';

const option: ProviderCatalogOption = {
  value: 'catalog:cline-pass',
  label: 'ClinePass',
  authKind: 'api-key',
  modelCount: 1,
  envVars: ['CLINE_API_KEY'],
  catalogId: 'cline-pass',
};

describe('catalogApiKeyDialogState', () => {
  it('prefills an env reference instead of copying the secret into the file', () => {
    const state = catalogApiKeyDialogState(option, { CLINE_API_KEY: 'sk-secret' });
    expect(state.prefill).toBe('{env:CLINE_API_KEY}');
    expect(state.subtitleLines.join('\n')).toContain('{env:CLINE_API_KEY}');
    expect(state.subtitleLines.join('\n')).not.toContain('sk-secret');
  });

  it('prefills the raw token when pasteSecret is set', () => {
    const state = catalogApiKeyDialogState(option, { CLINE_API_KEY: 'ghu_token' }, { pasteSecret: true });
    expect(state.prefill).toBe('ghu_token');
  });
});
