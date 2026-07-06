/**
 * Covers: createContext7Provider credential prompting.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

let sdkConstructCount = 0;

vi.mock('../../../src/tools/providers/context7', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/providers/context7')>();
  class MockSdkContext7Provider {
    constructor(_config: { apiKey: string }) {
      sdkConstructCount += 1;
    }

    searchLibraryText = vi.fn(async () => 'mock docs');
    getContextText = vi.fn(async () => 'mock docs');
    searchLibrary = vi.fn(async () => []);
    getContext = vi.fn(async () => []);
  }
  return {
    ...actual,
    SdkContext7Provider: MockSdkContext7Provider,
  };
});

import {
  Context7SetupCancelledError,
  createContext7Provider,
  isContext7Enabled,
  readContext7ApiKeyFromConfig,
} from '../../../src/tools/providers/context7-session';

describe('isContext7Enabled', () => {
  it('defaults to enabled when research.context7 is absent', () => {
    expect(isContext7Enabled({})).toBe(true);
  });

  it('respects enabled=false', () => {
    expect(isContext7Enabled({ research: { context7: { enabled: false } } })).toBe(false);
  });
});

describe('readContext7ApiKeyFromConfig', () => {
  it('reads inline apiKey from config', () => {
    expect(
      readContext7ApiKeyFromConfig({
        research: { context7: { apiKey: 'ctx7sk_test' } },
      }),
    ).toBe('ctx7sk_test');
  });
});

describe('createContext7Provider', () => {
  afterEach(() => {
    sdkConstructCount = 0;
  });

  it('prompts once, persists, and reuses the SDK client', async () => {
    const requestApiKey = vi.fn(async () => 'ctx7sk_prompted');
    const persistApiKey = vi.fn(async () => undefined);
    let storedKey: string | undefined;

    const provider = createContext7Provider({
      isEnabled: () => true,
      readApiKey: () => storedKey,
      requestApiKey,
      persistApiKey,
    });

    await expect(provider!.searchLibraryText('hooks', 'react', { toolCallId: 'call_1' })).resolves.toBe(
      'mock docs',
    );
    expect(requestApiKey).toHaveBeenCalledTimes(1);
    expect(persistApiKey).toHaveBeenCalledWith('ctx7sk_prompted');
    expect(sdkConstructCount).toBe(1);

    storedKey = 'ctx7sk_prompted';
    await expect(provider!.searchLibraryText('hooks', 'react', { toolCallId: 'call_2' })).resolves.toBe(
      'mock docs',
    );
    expect(requestApiKey).toHaveBeenCalledTimes(1);
    expect(sdkConstructCount).toBe(1);
  });

  it('throws Context7SetupCancelledError when the user declines setup', async () => {
    const provider = createContext7Provider({
      isEnabled: () => true,
      readApiKey: () => undefined,
      requestApiKey: async () => undefined,
    });

    await expect(provider!.searchLibraryText('hooks', 'react', {})).rejects.toBeInstanceOf(
      Context7SetupCancelledError,
    );
  });
});
