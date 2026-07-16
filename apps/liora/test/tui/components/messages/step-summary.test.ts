import { describe, expect, it } from 'vitest';

import { StepSummaryComponent } from '#/tui/components/messages/step-summary';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('StepSummaryComponent', () => {
  it('renders dense thinking and tool counts with a spark bar', () => {
    const component = new StepSummaryComponent();
    component.addCounts(5, 50);
    const text = strip(component.render(120).join('\n'));
    expect(text).toContain('thinking×5');
    expect(text).toContain('tools×50');
    expect(text).toMatch(/[░▒▓█]/);
    expect(text).toContain('…');
  });

  it('returns empty lines when no steps were recorded', () => {
    const component = new StepSummaryComponent();
    expect(component.isEmpty).toBe(true);
    expect(component.render(80)).toEqual([]);
  });
});
