import { describe, expect, it } from 'vitest';

import { StepSummaryComponent, buildSparkBar } from '#/tui/components/messages/step-summary';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/utils/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('StepSummaryComponent', () => {
  it('renders empty when no counts', () => {
    const component = new StepSummaryComponent();
    expect(component.isEmpty).toBe(true);
    expect(component.render(80)).toEqual([]);
  });

  it('renders dense spark with thinking/tool totals', () => {
    const component = new StepSummaryComponent();
    component.addCounts(5, 50);
    const out = strip(component.render(80).join('\n'));
    expect(out).toContain('thinking×5');
    expect(out).toContain('tools×50');
    expect(out).toContain('n=55');
    expect(out).toMatch(/[░▒▓█]{8}/);
  });

  it('buildSparkBar grows denser for larger totals', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'subtle', particles: 'off' });
    const small = buildSparkBar(1, DEFAULT_APPEARANCE_PREFERENCES);
    const large = buildSparkBar(64, DEFAULT_APPEARANCE_PREFERENCES);
    expect(small.length).toBeGreaterThan(0);
    expect(large.length).toBeGreaterThan(0);
    expect(large).not.toBe(small);
  });
});
