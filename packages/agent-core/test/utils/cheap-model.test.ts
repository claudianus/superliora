import { describe, expect, it } from 'vitest';

import { resolveSubagentModelAlias } from '../../src/utils/cheap-model';

const modelsWithCheap = {
  'main-model': { model: 'main-model' },
  'cheap-haiku': { model: 'cheap-haiku' },
};

const modelsWithoutCheap = {
  'main-model': { model: 'main-model' },
  'large-model': { model: 'large-model' },
};

describe('resolveSubagentModelAlias', () => {
  it('routes explore subagents to the cheap model when one is configured', () => {
    expect(resolveSubagentModelAlias('explore', undefined, 'main-model', modelsWithCheap)).toBe(
      'cheap-haiku',
    );
  });

  it('routes expert profiles based on explore by their base name', () => {
    expect(
      resolveSubagentModelAlias('code-reviewer', 'explore', 'main-model', modelsWithCheap),
    ).toBe('cheap-haiku');
  });

  it('falls back to the parent model when no cheap model is configured', () => {
    expect(resolveSubagentModelAlias('explore', undefined, 'main-model', modelsWithoutCheap)).toBe(
      'main-model',
    );
    expect(resolveSubagentModelAlias('explore', undefined, 'main-model', undefined)).toBe(
      'main-model',
    );
  });

  it('keeps the parent model for non-explore profiles even when a cheap model exists', () => {
    expect(resolveSubagentModelAlias('coder', undefined, 'main-model', modelsWithCheap)).toBe(
      'main-model',
    );
    expect(resolveSubagentModelAlias('plan', undefined, 'main-model', modelsWithCheap)).toBe(
      'main-model',
    );
    expect(resolveSubagentModelAlias('agent', undefined, 'main-model', modelsWithCheap)).toBe(
      'main-model',
    );
  });
});
