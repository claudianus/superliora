import { describe, expect, it } from 'vitest';

import {
  ExpandTool,
  LioraExpandTool,
  createExpandTool,
  createLioraExpandTool,
} from '../../../../src/tools/builtin/context/liora-expand';
import type { ToolStore } from '../../../../src/tools/store';

const store = {} as ToolStore;

describe('createLioraExpandTool', () => {
  it('registers tool name LioraExpand', () => {
    const tool = createLioraExpandTool(store);
    expect(tool).toBeInstanceOf(LioraExpandTool);
    expect(tool.name).toBe('LioraExpand');
  });
});

describe('createExpandTool', () => {
  it('registers sovereign tool name Expand', () => {
    const tool = createExpandTool(store);
    expect(tool).toBeInstanceOf(ExpandTool);
    expect(tool.name).toBe('Expand');
  });
});
