import { describe, expect, it } from 'vitest';

import {
  LOOP_MODEL_ROUTING_ROLES,
  loopModelRoutingDeletePath,
  loopModelRoutingPatch,
  loopModelRoutingRows,
} from '#/tui/utils/model/loop-model-routing';

describe('loop model routing', () => {
  it('maps exactly six loop roles to their explicit override state', () => {
    const rows = loopModelRoutingRows({
      loopControl: {
        compactionModel: 'compact-fast',
        codingModel: 'code-pro',
        debuggingModel: 'debug-pro',
      },
    });

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.key)).toEqual([
      'compaction',
      'completion',
      'exploration',
      'coding',
      'planning',
      'debugging',
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      'Compaction',
      'Completion',
      'Exploration',
      'Coding',
      'Planning',
      'Debugging',
    ]);
    expect(rows.find((row) => row.key === 'compaction')).toMatchObject({
      model: 'compact-fast',
      state: 'override · compact-fast',
    });
    expect(rows.find((row) => row.key === 'completion')).toMatchObject({
      state: 'default',
    });
    expect(rows.find((row) => row.key === 'coding')).toMatchObject({
      model: 'code-pro',
      state: 'override · code-pro',
    });
  });

  it('creates a one-role deep-merge patch and typed delete path', () => {
    const coding = LOOP_MODEL_ROUTING_ROLES.find((role) => role.key === 'coding')!;

    expect(loopModelRoutingPatch(coding, 'code-pro')).toEqual({
      loopControl: { codingModel: 'code-pro' },
    });
    expect(loopModelRoutingDeletePath(coding)).toBe('loopControl.codingModel');
  });
});
