import { describe, expect, it } from 'vitest';

import {
  classifyToolVerbKind,
  formatVerbGroupLabel,
  isSearchFamilyTool,
  turnActivityIdentity,
} from '#/tui/features/transcript/verb-group';

describe('classifyToolVerbKind', () => {
  it('maps built-in tools and MCP-style names', () => {
    expect(classifyToolVerbKind('Read')).toBe('file');
    expect(classifyToolVerbKind('Grep')).toBe('search');
    expect(classifyToolVerbKind('Edit')).toBe('edit');
    expect(classifyToolVerbKind('Agent')).toBe('subagent');
    expect(classifyToolVerbKind('mcp_github__create_issue')).toBe('mcp');
    expect(classifyToolVerbKind('Mystery')).toBe('other');
  });
});

describe('formatVerbGroupLabel', () => {
  it('uses present tense while any member is running', () => {
    expect(
      formatVerbGroupLabel([
        { name: 'Read', running: true },
        { name: 'Read', running: false },
        { name: 'Grep', running: false },
      ]),
    ).toBe('Reading 2 files · Searching 1 pattern');
  });

  it('uses past tense once the run settles', () => {
    expect(
      formatVerbGroupLabel([{ name: 'Edit' }, { name: 'Write' }, { name: 'Bash' }]),
    ).toBe('Edited 1 file · Wrote 1 file · Ran 1 command');
  });
});

describe('isSearchFamilyTool', () => {
  it('includes search and directory tools only', () => {
    expect(isSearchFamilyTool('Grep')).toBe(true);
    expect(isSearchFamilyTool('Glob')).toBe(true);
    expect(isSearchFamilyTool('LS')).toBe(true);
    expect(isSearchFamilyTool('LioraTree')).toBe(true);
    expect(isSearchFamilyTool('Read')).toBe(false);
    expect(isSearchFamilyTool('Agent')).toBe(false);
    expect(isSearchFamilyTool('Bash')).toBe(false);
  });
});

describe('turnActivityIdentity', () => {
  it('joins name and running bit for remount-free paints', () => {
    expect(turnActivityIdentity([{ name: 'Read', running: true }])).toBe('Read:1');
  });
});
