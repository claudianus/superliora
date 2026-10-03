import { describe, expect, it, vi } from 'vitest';

import { AuthFlowController, type AuthFlowHost } from '#/tui/controllers/auth/auth-flow';

describe('auth flow model metadata', () => {
  it('uses the configured provider context size without a synthetic pricing clamp', async () => {
    const models = {
      grok: { provider: 'xai', model: 'grok-example', maxContextSize: 3_000_000 },
    };
    const appState = { availableModels: models, model: '', maxContextTokens: 0 };
    const setModel = vi.fn(async () => undefined);
    const host = {
      state: { appState }, session: { setModel }, options: { startup: {} },
      harness: {
        getConfig: vi.fn(async () => ({ defaultModel: 'grok', models, providers: {} })),
      },
      setAppState: vi.fn((patch) => { Object.assign(appState, patch); }),
    } as unknown as AuthFlowHost;

    await new AuthFlowController(host).refreshConfigAfterLogin();

    expect(setModel).toHaveBeenCalledWith('grok');
    expect(appState.model).toBe('grok');
    expect(appState.maxContextTokens).toBe(3_000_000);
  });
});
