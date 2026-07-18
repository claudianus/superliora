import { describe, expect, it, vi } from 'vitest';

import {
  labelProviderOAuthRef,
  listProviderOAuthRefs,
  promoteProviderOAuthRef,
  removeProviderOAuthRef,
} from '@superliora/oauth';

import { handleAccountsCommand } from '#/tui/commands/accounts';
import { BUILTIN_SLASH_COMMANDS } from '#/tui/commands/registry';

describe('/accounts command wiring', () => {
  it('registers /accounts in the builtin slash command registry', () => {
    const entry = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'accounts');
    expect(entry).toBeDefined();
    expect(entry?.description.toLowerCase()).toContain('oauth');
  });

  it('shows empty-state status when no OAuth pools exist', async () => {
    const showStatus = vi.fn();
    const mountEditorReplacement = vi.fn();
    const host = {
      harness: {
        getConfig: vi.fn(async () => ({ providers: {}, models: {} })),
        setConfig: vi.fn(),
      },
      state: {
        appState: {
          model: '',
          availableModels: {},
          availableProviders: {},
        },
      },
      setAppState: vi.fn(),
      showStatus,
      showError: vi.fn(),
      mountEditorReplacement,
      restoreEditor: vi.fn(),
    };

    await handleAccountsCommand(host as never);
    expect(showStatus).toHaveBeenCalledWith(
      expect.stringContaining('No OAuth accounts configured'),
    );
    expect(mountEditorReplacement).not.toHaveBeenCalled();
  });

  it('opens the accounts list when a single OAuth pool exists', async () => {
    const mountEditorReplacement = vi.fn();
    const host = {
      harness: {
        getConfig: vi.fn(async () => ({
          providers: {
            'xai-grok': {
              type: 'openai',
              oauth: { storage: 'file', key: 'xai-grok', label: 'work' },
              oauths: [{ storage: 'file', key: 'xai-grok-account-abc' }],
            },
          },
          models: {},
        })),
        setConfig: vi.fn(),
      },
      state: {
        appState: {
          model: '',
          availableModels: {},
          availableProviders: {},
        },
      },
      setAppState: vi.fn(),
      showStatus: vi.fn(),
      showError: vi.fn(),
      mountEditorReplacement,
      restoreEditor: vi.fn(),
    };

    await handleAccountsCommand(host as never);
    // Async list mount is fire-and-forget after the single-pool branch.
    await vi.waitFor(() => {
      expect(mountEditorReplacement).toHaveBeenCalled();
    });
    const panel = mountEditorReplacement.mock.calls[0]?.[0] as { render?: (w: number) => string[] };
    expect(panel?.render?.(120).join('\n')).toContain('Accounts · xai-grok');
  });
});

describe('accounts persist helpers (shared oauth pool)', () => {
  const provider = {
    type: 'openai',
    oauth: { storage: 'file' as const, key: 'primary', label: 'home' },
    oauths: [{ storage: 'file' as const, key: 'fallback', label: 'work' }],
  };

  it('promote rewrites oauth/oauths order', () => {
    const result = promoteProviderOAuthRef(provider, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listProviderOAuthRefs(result.provider).map((ref) => ref.key)).toEqual([
      'fallback',
      'primary',
    ]);
    expect(result.provider['oauth']).toEqual({
      storage: 'file',
      key: 'fallback',
      label: 'work',
    });
    expect(result.provider['oauths']).toEqual([
      { storage: 'file', key: 'primary', label: 'home' },
    ]);
  });

  it('label and remove persist shape', () => {
    const labeled = labelProviderOAuthRef(provider, 0, 'desk');
    expect(labeled.ok).toBe(true);
    if (!labeled.ok) return;
    expect(listProviderOAuthRefs(labeled.provider)[0]?.label).toBe('desk');

    const removed = removeProviderOAuthRef(provider, 1);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.remaining).toBe(1);
    // Empty array (not omit) so deep-merge setConfig clears stale fallbacks.
    expect(removed.provider['oauths']).toEqual([]);
    expect(listProviderOAuthRefs(removed.provider).map((ref) => ref.key)).toEqual(['primary']);
  });
});
