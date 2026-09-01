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

  it('does not flag a11y attribute notation (href=# anchors, placeholder attrs)', () => {
    const result = auditSurfaceCraft({
      title: 'Billing',
      snapshot:
        '- link "Reports" [href=#reports]\n- textbox "Email" [placeholder="you@example.test"]\n- button "Save changes"',
    });
    expect(result.pass).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('does not flag todo-app product copy', () => {
    const result = auditSurfaceCraft({
      title: 'Todo',
      snapshot: 'Todo List — 3 items remaining. Add a todo.',
    });
    expect(result.pass).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('still fails on visible placeholder copy and TODO markers', () => {
    const result = auditSurfaceCraft({
      snapshot: 'Placeholder content goes here. TODO: wire up the API.',
    });
    expect(result.pass).toBe(false);
    expect(result.hits).toContain('placeholder_copy');
    expect(result.hits).toContain('todo_marker');
  });

  it('fails on coming soon / tbd copy', () => {
    const soon = auditSurfaceCraft({ snapshot: 'Pricing — coming soon' });
    expect(soon.pass).toBe(false);
    expect(soon.hits).toContain('placeholder_copy');
    const tbd = auditSurfaceCraft({ snapshot: 'Exports are tbd for this release' });
    expect(tbd.pass).toBe(false);
    expect(tbd.hits).toContain('placeholder_copy');
  });
});
