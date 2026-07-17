import { describe, expect, it } from 'vitest';

import { setCliLocale } from '#/cli/i18n';
import { ALL_TIPS, WORKING_TIPS } from '#/tui/constant/tips';
import { ttui } from '#/tui/utils/tui-i18n';

describe('tips constants', () => {
  it('ALL_TIPS is non-empty', () => {
    expect(ALL_TIPS.length).toBeGreaterThan(0);
  });

  it('tip keys are unique across ALL_TIPS', () => {
    const keys = ALL_TIPS.map((tip) => tip.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every tip has a non-empty key and translated text', () => {
    setCliLocale('en');
    for (const tip of ALL_TIPS) {
      expect(tip.key.length).toBeGreaterThan(0);
      expect(ttui(tip.key).length).toBeGreaterThan(0);
      expect(ttui(tip.key)).not.toBe(tip.key);
    }
    setCliLocale('ko');
    for (const tip of ALL_TIPS) {
      expect(ttui(tip.key).length).toBeGreaterThan(0);
      expect(ttui(tip.key)).not.toBe(tip.key);
    }
    setCliLocale('en');
  });

  it('every tip has valid optional properties', () => {
    for (const tip of ALL_TIPS) {
      if (tip.priority !== undefined) {
        expect(tip.priority).toBeGreaterThan(0);
      }
      if (tip.solo !== undefined) {
        expect(typeof tip.solo).toBe('boolean');
      }
    }
  });

  it('WORKING_TIPS is non-empty', () => {
    expect(WORKING_TIPS.length).toBeGreaterThan(0);
  });

  it('every working tip is included in ALL_TIPS', () => {
    for (const workingTip of WORKING_TIPS) {
      expect(ALL_TIPS.some((tip) => tip.key === workingTip.key)).toBe(true);
    }
  });

  it('shared working tips match ALL_TIPS priority and solo values', () => {
    for (const workingTip of WORKING_TIPS) {
      const allTip = ALL_TIPS.find((tip) => tip.key === workingTip.key);
      expect(allTip).toBeDefined();
      expect(allTip?.priority).toBe(workingTip.priority);
      expect(allTip?.solo).toBe(workingTip.solo);
    }
  });

  it('nudges users toward natural task prompts before workflow command names', () => {
    expect(WORKING_TIPS.some((tip) => tip.key === 'tui.tip.outcome')).toBe(true);
    expect(WORKING_TIPS.some((tip) => tip.key.startsWith('tui.tip.goalFor'))).toBe(false);
  });

  it('does not recommend hidden Easter egg commands', () => {
    setCliLocale('en');
    const text = ALL_TIPS.map((tip) => ttui(tip.key)).join('\n').toLowerCase();

    expect(text).not.toContain('/dance');
    expect(text).not.toContain('easter');
  });

  it('keeps default toolbar tips on Ultrawork wording instead of legacy plan mode wording', () => {
    setCliLocale('en');
    const text = ALL_TIPS.map((tip) => ttui(tip.key)).join('\n');

    expect(text).toContain('Ultrawork');
    expect(text).not.toMatch(/\bPlan mode\b/i);
  });
});
