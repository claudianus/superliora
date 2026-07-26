import { describe, expect, it } from 'vitest';

import {
  createAnchorDocument,
  extractAnchorDiff,
  mergeIntoAnchor,
  renderAnchor,
} from '../../../src/agent/compaction/anchor';

describe('createAnchorDocument', () => {
  it('seeds intent and leaves arrays empty', () => {
    const anchor = createAnchorDocument('ship the auth flow');
    expect(anchor.intent).toBe('ship the auth flow');
    expect(anchor.changes).toEqual([]);
    expect(anchor.decisions).toEqual([]);
    expect(anchor.nextSteps).toEqual([]);
  });
});

describe('mergeIntoAnchor', () => {
  it('appends and dedupes changes / decisions / nextSteps', () => {
    const base = createAnchorDocument('intent');
    const merged = mergeIntoAnchor(base, {
      changes: ['add auth.ts', 'add auth.ts'],
      decisions: ['use bcrypt'],
      nextSteps: ['write tests'],
    });
    expect(merged.changes).toEqual(['add auth.ts']);
    expect(merged.decisions).toEqual(['use bcrypt']);
    expect(merged.nextSteps).toEqual(['write tests']);
  });

  it('keeps the original intent when the diff has none', () => {
    const base = createAnchorDocument('original');
    const merged = mergeIntoAnchor(base, { changes: ['x'] });
    expect(merged.intent).toBe('original');
  });

  it('overrides the intent when the diff supplies one', () => {
    const base = createAnchorDocument('original');
    const merged = mergeIntoAnchor(base, { intent: 'new' });
    expect(merged.intent).toBe('new');
  });

  it('caps each list at the documented limit', () => {
    const base = createAnchorDocument('intent');
    const merged = mergeIntoAnchor(base, {
      changes: Array.from({ length: 100 }, (_, i) => `change-${i}`),
      decisions: Array.from({ length: 50 }, (_, i) => `dec-${i}`),
      nextSteps: Array.from({ length: 30 }, (_, i) => `next-${i}`),
    });
    expect(merged.changes.length).toBeLessThanOrEqual(30);
    expect(merged.decisions.length).toBeLessThanOrEqual(20);
    expect(merged.nextSteps.length).toBeLessThanOrEqual(10);
  });
});

describe('renderAnchor', () => {
  it('returns an empty string when no body content is present', () => {
    const anchor = createAnchorDocument('ship the auth flow');
    expect(renderAnchor(anchor)).toBe('');
  });

  it('renders intent + changes + decisions + next steps', () => {
    const anchor = {
      intent: 'ship the auth flow',
      changes: ['add auth.ts'],
      decisions: ['use bcrypt'],
      nextSteps: ['write tests'],
    };
    const text = renderAnchor(anchor);
    expect(text).toContain('ship the auth flow');
    expect(text).toContain('add auth.ts');
    expect(text).toContain('use bcrypt');
    expect(text).toContain('write tests');
    expect(text).toContain('## Changes Made');
    expect(text).toContain('## Decisions Taken');
    expect(text).toContain('## Next Steps');
  });
});

describe('extractAnchorDiff', () => {
  it('extracts changes / decisions / nextSteps from a summary', () => {
    const summary = [
      '## Changes Made',
      '- add auth.ts',
      '- add middleware.ts',
      '',
      '## Decisions Taken',
      '- use bcrypt',
      '',
      '## Next Steps',
      '- write tests',
    ].join('\n');
    const diff = extractAnchorDiff(summary);
    expect(diff.changes).toEqual(['add auth.ts', 'add middleware.ts']);
    expect(diff.decisions).toEqual(['use bcrypt']);
    expect(diff.nextSteps).toEqual(['write tests']);
  });

  it('returns an empty diff for prose without anchor sections', () => {
    const diff = extractAnchorDiff('plain prose, no headings');
    expect(diff.changes ?? []).toEqual([]);
    expect(diff.decisions ?? []).toEqual([]);
    expect(diff.nextSteps ?? []).toEqual([]);
  });
});
