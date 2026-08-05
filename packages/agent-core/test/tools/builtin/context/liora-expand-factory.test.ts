import { describe, expect, it } from 'vitest';

import {
  ExpandTool,
  createExpandTool,
} from '../../../../src/tools/builtin/context/liora-expand';
import type { ToolStore } from '../../../../src/tools/store';

const store = {} as ToolStore;

describe('createExpandTool', () => {
  it('registers sovereign tool name Expand', () => {
    const tool = createExpandTool(store);
    expect(tool).toBeInstanceOf(ExpandTool);
    expect(tool.name).toBe('Expand');
  });
});
