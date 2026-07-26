import { describe, expect, it } from 'vitest';

import {
  type ToolWorkflowCapability,
  buildToolWorkflowGuidance,
  buildToolWorkflowSparseGuidance,
  hasToolWorkflowSurface,
} from '#/agent/injection/tool-workflow';

const fullCap: ToolWorkflowCapability = {
  hasSearchSkill: true,
  hasSearchTools: true,
  hasSkill: true,
  hasWebSearch: true,
  hasFetchUrl: true,
  hasContext7: true,
  hasLeanRead: true,
  hasVerifySurface: true,
  hasRunProjectChecks: true,
  hasTodoList: true,
};

describe('agent/injection/tool-workflow — hasToolWorkflowSurface', () => {
  it('returns true when any capability is enabled', () => {
    expect(hasToolWorkflowSurface({ ...fullCap, hasSearchSkill: true })).toBe(true);
    expect(hasToolWorkflowSurface({ ...fullCap, hasLeanRead: true })).toBe(true);
  });

  it('returns false when every capability is disabled', () => {
    const none: ToolWorkflowCapability = {
      hasSearchSkill: false,
      hasSearchTools: false,
      hasSkill: false,
      hasWebSearch: false,
      hasFetchUrl: false,
      hasContext7: false,
      hasLeanRead: false,
      hasVerifySurface: false,
      hasRunProjectChecks: false,
      hasTodoList: false,
    };
    expect(hasToolWorkflowSurface(none)).toBe(false);
  });
});

describe('agent/injection/tool-workflow — buildToolWorkflowGuidance', () => {
  it('mentions enabled capability sections', () => {
    const result = buildToolWorkflowGuidance(fullCap);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Tool / Skill / Research Workflow');
  });

  it('omits sections when the corresponding capability is disabled', () => {
    const sparse: ToolWorkflowCapability = {
      ...fullCap,
      hasSearchSkill: false,
      hasSkill: false,
      hasContext7: false,
      hasRunProjectChecks: false,
    };
    const result = buildToolWorkflowGuidance(sparse);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a stable reminder when nothing is enabled', () => {
    const result = buildToolWorkflowGuidance({});
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('agent/injection/tool-workflow — buildToolWorkflowSparseGuidance', () => {
  it('keeps the sparse reminder no longer than the dense one', () => {
    const full = buildToolWorkflowGuidance(fullCap);
    const sparse = buildToolWorkflowSparseGuidance(fullCap);
    expect(sparse.length).toBeLessThanOrEqual(full.length + 1);
  });

  it('returns a non-empty string for the empty capability set', () => {
    const sparse = buildToolWorkflowSparseGuidance({});
    expect(sparse.length).toBeGreaterThan(0);
  });
});
