import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  renderFleetModelCatalog,
  selectFleetCatalogRows,
} from '../../../src/agent/injection/fleet-model-catalog';
import { resetModelRouteHealthStoreForTests } from '../../../src/agent/routing';
import type { LioraConfig } from '../../../src/config';

const PROVIDER = {
  type: 'kimi' as const,
  apiKey: 'test-key',
};

function config(partial: Partial<LioraConfig> & { models: LioraConfig['models'] }): LioraConfig {
  return {
    providers: { 'test-provider': PROVIDER },
    ...partial,
  } as LioraConfig;
}

describe('fleet model catalog', () => {
  beforeEach(() => {
    resetModelRouteHealthStoreForTests();
  });
  afterEach(() => {
    resetModelRouteHealthStoreForTests();
  });

  it('ranks healthy tool-capable aliases and renders a capped card', () => {
    const cfg = config({
      models: {
        cheap: {
          provider: 'test-provider',
          model: 'cheap',
          maxContextSize: 64_000,
          capabilities: ['tool_use'],
          cost: { input: 0.1 },
        },
        strong: {
          provider: 'test-provider',
          model: 'strong',
          maxContextSize: 200_000,
          capabilities: ['tool_use', 'thinking', 'image_in'],
          cost: { input: 5 },
        },
      },
    });
    const rows = selectFleetCatalogRows(cfg);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const text = renderFleetModelCatalog(cfg);
    expect(text).toContain('<fleet_model_catalog>');
    expect(text).toContain('JobCreate.model_alias');
    expect(text).toMatch(/cheap|strong/);
  });
});
