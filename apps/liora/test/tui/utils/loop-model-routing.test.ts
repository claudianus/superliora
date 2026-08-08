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
      source: 'override',
    });
    expect(rows.find((row) => row.key === 'completion')).toMatchObject({
      state: 'auto',
    });
    expect(rows.find((row) => row.key === 'coding')).toMatchObject({
      model: 'code-pro',
      state: 'override · code-pro',
    });
    expect(rows.find((row) => row.key === 'planning')?.description).toMatch(/Plan \/ mission/i);
  });

  it('previews auto picks from the local catalog when a role is unset', () => {
    const rows = loopModelRoutingRows(
      { loopControl: {} },
      {
        'qwen-token-plan/qwen3.8-max-preview': {
          provider: 'qwen-token-plan',
          model: 'qwen3.8-max-preview',
          maxContextSize: 1_000_000,
          capabilities: ['thinking', 'tool_use'],
        },
        'qwen-token-plan/qwen3.6-flash': {
          provider: 'qwen-token-plan',
          model: 'qwen3.6-flash',
          maxContextSize: 1_000_000,
          capabilities: ['thinking', 'tool_use'],
        },
      },
    );

    expect(rows.find((row) => row.key === 'planning')).toMatchObject({
      source: 'auto',
      resolvedAlias: 'qwen-token-plan/qwen3.8-max-preview',
      state: 'auto → qwen-token-plan/qwen3.8-max-preview',
    });
    expect(rows.find((row) => row.key === 'exploration')).toMatchObject({
      source: 'auto',
      resolvedAlias: 'qwen-token-plan/qwen3.6-flash',
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
