import { describe, expect, it } from 'vitest';

import { auditSurfaceCraft } from '../../src/tools/builtin/gui/surface-craft-audit';

describe('auditSurfaceCraft', () => {
  it('fails on lorem ipsum / placeholder copy', () => {
    const result = auditSurfaceCraft({ snapshot: 'Welcome — lorem ipsum dolor sit amet' });
    expect(result.pass).toBe(false);
    expect(result.hits).toContain('lorem_ipsum');
  });

  it('passes clean product copy', () => {
    const result = auditSurfaceCraft({
      title: 'Settings',
      snapshot: 'Manage your workspace appearance and keyboard shortcuts.',
    });
    expect(result.pass).toBe(true);
    expect(result.hits).toEqual([]);
  });
});
