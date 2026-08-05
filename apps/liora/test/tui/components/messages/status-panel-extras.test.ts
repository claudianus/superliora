import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderExtrasStatus } from '@superliora/sdk';

import { extrasStatusRows } from '#/tui/components/messages/status-panel/extras';

function makeExtras(overrides: Partial<ProviderExtrasStatus> = {}): ProviderExtrasStatus {
  return {
    providers: [
      {
        id: 'zai',
        label: 'Z.AI (GLM Coding Plan)',
        source: 'env',
        capabilities: ['web_search', 'mcp_servers'],
        disabled: false,
      },
      {
        id: 'openai-codex',
        label: 'OpenAI Codex (ChatGPT)',
        source: 'oauth',
        capabilities: ['web_search', 'image_gen'],
        disabled: true,
      },
    ],
    searchCascade: [
      { id: 'brave', kind: 'remote', label: 'Brave', ready: true, source: 'env' },
      { id: 'local', kind: 'local', label: 'Local', ready: true, source: 'local' },
    ],
    media: { image: ['xai-grok', 'codex'], video: ['xai-grok'] },
    autoMcpServers: ['zai-web-search', 'zai-vision'],
    ...overrides,
  };
}

describe('status panel extras rows', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists detected providers with source, capabilities, and off flag', () => {
    const rows = extrasStatusRows(makeExtras());
    expect(rows[0]).toEqual({
      label: 'Z.AI (GLM Coding Plan)',
      value: 'env · search/mcp',
    });
    expect(rows[1]).toEqual({
      label: 'OpenAI Codex (ChatGPT)',
      value: 'oauth · search/image · off',
      severity: 'warning',
    });
  });

  it('renders cascade order, media backends, and auto MCP servers', () => {
    const rows = extrasStatusRows(makeExtras());
    const byLabel = new Map(rows.map((row) => [row.label, row]));
    expect(byLabel.get('Search cascade')?.value).toBe('Brave → Local');
    expect(byLabel.get('Media auto')?.value).toBe('image: xai-grok → codex · video: xai-grok');
    expect(byLabel.get('MCP auto')?.value).toBe('zai-web-search, zai-vision');
  });

  it('marks cooling cascade slots and warns when no media backend exists', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const rows = extrasStatusRows(
      makeExtras({
        searchCascade: [
          {
            id: 'brave',
            kind: 'remote',
            label: 'Brave',
            ready: false,
            source: 'env',
            cooldownUntil: now + 30_000,
          },
          { id: 'local', kind: 'local', label: 'Local', ready: true, source: 'local' },
        ],
        media: { image: [], video: [] },
        autoMcpServers: [],
      }),
    );
    const byLabel = new Map(rows.map((row) => [row.label, row]));
    expect(byLabel.get('Search cascade')?.value).toBe('Brave (cooling 30s) → Local');
    expect(byLabel.get('Media auto')).toEqual({
      label: 'Media auto',
      value: 'no backend detected',
      severity: 'warning',
    });
    expect(byLabel.has('MCP auto')).toBe(false);
  });

  it('caps provider rows and reports overflow', () => {
    const providers = Array.from({ length: 8 }, (_, index) => ({
      id: `p${String(index)}`,
      label: `Provider ${String(index)}`,
      source: 'env' as const,
      capabilities: ['web_search' as const],
      disabled: false,
    }));
    const rows = extrasStatusRows(makeExtras({ providers }));
    expect(rows.some((row) => row.label === 'More' && row.value === '2 more detected')).toBe(true);
  });
});
