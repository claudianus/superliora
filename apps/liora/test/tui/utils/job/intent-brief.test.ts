/**
 * Intent Composer brief builder — structured prefix + mode defaults.
 */

import { describe, expect, it } from 'vitest';

import {
  askUserQuestionTemplateForIncompleteBrief,
  attachStructuredBrief,
  buildStructuredBriefPrefix,
  cycleConductorProjectMode,
  intentBriefHasFields,
  intentBriefIncompleteForGreenfield,
  intentComposerExpandedByDefault,
  type IntentBriefFields,
} from '#/tui/utils/job/intent-brief';

const SAMPLE: IntentBriefFields = {
  successCriteria: ['tests green'],
  mustNotTouch: ['apps/liora'],
  verificationCommands: ['pnpm test'],
  contextPaths: ['packages/foo'],
};

describe('intent-brief', () => {
  it('builds a structured prefix with all slots', () => {
    const prefix = buildStructuredBriefPrefix(SAMPLE);
    expect(prefix).toContain('[Conductor brief]');
    expect(prefix).toContain('Success criteria:');
    expect(prefix).toContain('- tests green');
    expect(prefix).toContain('Must not touch:');
    expect(prefix).toContain('Verification commands:');
    expect(prefix).toContain('Context paths:');
  });

  it('attaches brief above the free-text prompt', () => {
    const out = attachStructuredBrief('Fix the login bug', SAMPLE);
    expect(out.startsWith('[Conductor brief]')).toBe(true);
    expect(out).toContain('---');
    expect(out.endsWith('Fix the login bug')).toBe(true);
  });

  it('reports empty vs filled fields', () => {
    expect(intentBriefHasFields(SAMPLE)).toBe(true);
    expect(
      intentBriefHasFields({
        successCriteria: [],
        mustNotTouch: [],
        verificationCommands: [],
        contextPaths: [],
      }),
    ).toBe(false);
  });

  it('cycles project modes and expands greenfield by default', () => {
    expect(cycleConductorProjectMode('balanced')).toBe('greenfield');
    expect(cycleConductorProjectMode('review')).toBe('balanced');
    expect(intentComposerExpandedByDefault('greenfield')).toBe(true);
    expect(intentComposerExpandedByDefault('hotfix')).toBe(false);
  });

  it('builds AskUserQuestion-friendly template for incomplete greenfield brief', () => {
    const empty: IntentBriefFields = {
      successCriteria: [],
      mustNotTouch: [],
      verificationCommands: [],
      contextPaths: [],
    };
    expect(intentBriefIncompleteForGreenfield(empty)).toBe(true);
    const template = askUserQuestionTemplateForIncompleteBrief(empty);
    expect(template).toMatch(/Success criteria/i);
    expect(template).toMatch(/incomplete/i);
    expect(askUserQuestionTemplateForIncompleteBrief(SAMPLE)).toBe('');
  });
});
