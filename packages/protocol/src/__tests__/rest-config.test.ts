import { describe, expect, it } from 'vitest';

import {
  configResponseSchema,
  patchConfigRequestSchema,
} from '../rest/config';

describe('REST config contract', () => {
  it('accepts every persisted config section without falling back to raw', () => {
    const sections = {
      media: { non_vision_fallback: 'path' },
      memory: { enabled: true },
      cache: { invalidate_epoch: 2 },
      research: { enabled: true },
      mission: { auto_start: true },
      model_catalog: { refresh_on_start: false },
      browser_use: { enabled: true },
      computer_use: { enabled: false },
      mcp: { auto_provider_servers: false },
      extras: { disabled_providers: ['zai'] },
      persona: { preset: 'efficient' },
      agent: { profile: 'core' },
    };

    expect(
      configResponseSchema.parse({
        providers: {},
        ...sections,
      }),
    ).toMatchObject(sections);
    expect(patchConfigRequestSchema.parse(sections)).toMatchObject(sections);
  });
});
