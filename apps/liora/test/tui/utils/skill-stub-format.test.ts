import { describe, expect, it } from 'vitest';

import { formatSkillStubFromTitle } from '#/tui/utils/skills/skill-stub-format';

describe('formatSkillStubFromTitle', () => {
  it('formats frontmatter and body from a title', () => {
    const stub = formatSkillStubFromTitle('Write TUI footer badges');
    expect(stub).toContain('name: write-tui-footer-badges');
    expect(stub).toContain('Write TUI footer badges');
    expect(stub).toContain('disable-model-invocation: true');
    expect(stub).toContain('Trace→Skill draft');
    expect(stub).toContain('## When to use');
    expect(stub).toContain('## Workflow');
  });

  it('uses untitled-skill for blank titles', () => {
    const stub = formatSkillStubFromTitle('   ');
    expect(stub).toContain('name: untitled-skill');
    expect(stub).toContain('# Untitled skill');
  });
});
