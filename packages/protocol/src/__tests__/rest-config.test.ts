import { describe, expect, it } from 'vitest';

import {
  configResponseSchema,
  patchConfigRequestSchema,
} from '../rest/config';

describe('REST config contract', () => {
  it('accepts every persisted config section without falling back to raw', () => {
    const sections = {
      cache: { invalidate_epoch: 2 },
      model_catalog: { refresh_on_start: false },
      sandbox_profile: 'workspace-write',
      sandbox_enforcement: 'required',
      permission: { mode: 'manual' },
      loop_control: { max_steps_per_turn: 50 },
      background: { max_output_bytes: 4096 },
    };

    expect(
      configResponseSchema.parse({
        providers: {},
        ...sections,
      }),
    ).toMatchObject(sections);
    expect(patchConfigRequestSchema.parse(sections)).toMatchObject(sections);
  });

  it('rejects unsupported configuration sections instead of acknowledging a no-op', () => {
    expect(patchConfigRequestSchema.safeParse({ unsupported_section: {} }).success).toBe(false);
  });
});
