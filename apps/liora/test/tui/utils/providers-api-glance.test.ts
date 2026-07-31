import { describe, expect, it } from 'vitest';

import {
  OSS_ABSORB_LICENSE_TIP,
  PROVIDERS_FREE_SEARCH_TIP,
  buildProvidersApiSettingsLines,
  formatActiveModelLine,
  formatActiveProviderLine,
  loadProvidersApiGlance,
  resolveProvidersApiSessionGlance,
} from '#/tui/utils/provider/providers-api-glance';
import { SEARCH_PREFER_XAI_TIP } from '#/tui/commands/config/search-status';

describe('providers-api-glance', () => {
  it('detects configured provider env keys without echoing values', () => {
    const glance = loadProvidersApiGlance({
      ANTHROPIC_API_KEY: 'secret',
      OPENAI_API_KEY: 'secret',
    } as NodeJS.ProcessEnv);

    expect(glance.configuredLabels).toEqual(['Anthropic', 'OpenAI']);
    const lines = buildProvidersApiSettingsLines(glance).join('\n');
    expect(lines).toContain('Providers & API (read-only)');
    expect(lines).toContain('Anthropic, OpenAI');
    expect(lines).not.toContain('secret');
    expect(lines).toContain('/login');
    expect(lines).toContain('Proactive refresh');
    expect(lines).toContain('Account pool');
    expect(lines).toContain('401 failover');
    expect(lines).toContain('KIMI_API_KEY');
    expect(lines).toContain(PROVIDERS_FREE_SEARCH_TIP);
    expect(lines).toContain(OSS_ABSORB_LICENSE_TIP);
    expect(lines).not.toContain('PreferXai');
  });

  it('surfaces PreferXai tip only when WebSearch is active in session', () => {
    const withWeb = buildProvidersApiSettingsLines({
      configuredLabels: [],
      registryKeySet: false,
      providerKeySet: false,
      webSearchActive: true,
    }).join('\n');
    expect(withWeb).toContain(SEARCH_PREFER_XAI_TIP);
    expect(withWeb).toContain(PROVIDERS_FREE_SEARCH_TIP);

    const withoutWeb = buildProvidersApiSettingsLines({
      configuredLabels: [],
      registryKeySet: false,
      providerKeySet: false,
      webSearchActive: false,
    }).join('\n');
    expect(withoutWeb).not.toContain('PreferXai');
    expect(withoutWeb).toContain(OSS_ABSORB_LICENSE_TIP);
  });

  it('reports empty env posture', () => {
    const glance = loadProvidersApiGlance({} as NodeJS.ProcessEnv);
    const lines = buildProvidersApiSettingsLines(glance).join('\n');
    expect(lines).toContain('No common provider API keys detected');
    expect(lines).toContain('No key editor here');
  });

  it('includes live session section with active provider/model from status', () => {
    const session = resolveProvidersApiSessionGlance({
      statusModel: 'kimi-k2',
      availableModels: {
        'kimi-k2': {
          displayName: 'Kimi K2',
          model: 'kimi-k2-upstream',
          provider: 'moonshot',
          maxContextSize: 256_000,
        },
      },
      providerRouteStatus: { primary: true } as never,
      catalogModels: 12,
      catalogProviders: 3,
    });

    expect(formatActiveModelLine(session)).toContain('Kimi K2 (kimi-k2)');
    expect(formatActiveModelLine(session)).toContain('live session confirms');
    expect(formatActiveProviderLine(session)).toBe(
      'Active provider: moonshot · upstream kimi-k2-upstream',
    );

    const lines = buildProvidersApiSettingsLines({
      configuredLabels: ['Anthropic'],
      registryKeySet: false,
      providerKeySet: false,
      session,
    }).join('\n');

    expect(lines).toContain('── Session (live) ─');
    expect(lines).toContain('Active model: Kimi K2 (kimi-k2) · live session confirms');
    expect(lines).toContain('Active provider: moonshot · upstream kimi-k2-upstream');
    expect(lines).toContain('Catalog: 12 models / 3 providers');
    expect(lines).toContain('Route: primary');
  });

  it('reports session unavailable without live session confirms', () => {
    const session = resolveProvidersApiSessionGlance({
      sessionUnavailable: true,
      catalogModels: 0,
      catalogProviders: 0,
    });
    const lines = buildProvidersApiSettingsLines({
      configuredLabels: [],
      registryKeySet: false,
      providerKeySet: false,
      session,
    }).join('\n');

    expect(lines).toContain('no active session');
    expect(lines).not.toContain('live session confirms');
  });
});
