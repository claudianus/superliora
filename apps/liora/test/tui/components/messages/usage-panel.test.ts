import { visibleWidth } from '#/tui/renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { buildUsageReportLines, UsagePanelComponent } from '#/tui/components/messages/usage-panel';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';

afterEach(() => {
  currentTheme.setPalette(darkColors);
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('UsagePanelComponent', () => {
  it('formats session, context, and managed usage sections', () => {
    const lines = buildUsageReportLines({
      sessionUsage: {
        byModel: {
          kimi: {
            inputOther: 1000,
            inputCacheRead: 500,
            inputCacheCreation: 500,
            output: 250,
          },
        },
      } as never,
      contextUsage: 0.25,
      contextTokens: 2500,
      maxContextTokens: 10000,
      managedUsage: {
        summary: {
          label: 'daily',
          used: 20,
          limit: 100,
          resetHint: 'resets tomorrow',
        },
        limits: [],
      },
    }).map(strip);

    expect(lines).toContain('Session usage');
    expect(lines).toContain('  kimi  input 2.0K  output 250  total 2.3K');
    expect(lines).toContain('  kimi cache  read 500  write 500  share 50%');
    expect(lines).toContain('Cache efficiency');
    expect(lines.join('\n')).toContain('50% cached input');
    expect(lines.join('\n')).toMatch(/Read\s+500 tokens/);
    expect(lines.join('\n')).toMatch(/Write\s+500 tokens/);
    expect(lines.join('\n')).toMatch(/Next\s+Continue; cache is ready for long work\./);
    expect(lines).toContain('Context window');
    expect(lines.join('\n')).toContain('25.0%');
    expect(lines.join('\n')).toMatch(/Remaining\s+7\.5K tokens/);
    expect(lines.join('\n')).toMatch(/Next\s+Continue; plenty of room for long work\./);
    expect(lines).toContain('Plan usage');
    expect(lines.join('\n')).toContain('20% used');
    expect(lines.join('\n')).toContain('resets tomorrow');
  });

  it('shows a next action before token usage exists', () => {
    const lines = buildUsageReportLines({
      sessionUsage: undefined,
      contextUsage: 0,
      contextTokens: 0,
      maxContextTokens: 10000,
    }).map(strip);

    expect(lines).toContain('Session usage');
    expect(lines).toContain('  No token usage recorded yet. Send a message to start tracking.');
    expect(lines).toContain('  session  input 0  output 0  total 0');
    expect(lines).toContain('  session cache  read 0  write 0  share 0%');
    expect(lines).toContain('Cache efficiency');
    expect(lines.join('\n')).toContain('0% cached input');
    expect(lines.join('\n')).toMatch(/Read\s+0 tokens/);
    expect(lines.join('\n')).toMatch(/Write\s+0 tokens/);
    expect(lines.join('\n')).toMatch(/Next\s+Continue; cache warms after repeated context\./);
    expect(lines.join('\n')).toMatch(/Remaining\s+10\.0K tokens/);
    expect(lines.join('\n')).toMatch(/Next\s+Continue; plenty of room for long work\./);
  });

  it('shows compact as the next action when context is high', () => {
    const lines = buildUsageReportLines({
      sessionUsage: undefined,
      contextUsage: 0.9,
      contextTokens: 9000,
      maxContextTokens: 10000,
    }).map(strip);

    expect(lines.join('\n')).toContain('90.0%');
    expect(lines.join('\n')).toMatch(/Remaining\s+1\.0K tokens/);
    expect(lines.join('\n')).toMatch(/Next\s+Run \/compact before long work\./);
  });

  it('wraps preformatted usage lines in a bordered panel', () => {
    const component = new UsagePanelComponent(() => ['Session usage'], 'primary');
    const output = component.render(80).map(strip);

    expect(output[0]).toContain(' Usage ');
    expect(output[1]).toContain('Session usage');
  });

  it('truncates lines wider than the terminal so the panel never overflows', () => {
    const longLine = 'error: ' + 'x'.repeat(200);
    const component = new UsagePanelComponent(() => [longLine], 'primary');
    const width = 60;

    const output = component.render(width);

    for (const line of output) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it('keeps the bordered panel within narrow terminal widths', () => {
    const component = new UsagePanelComponent(() => ['Session usage', '  kimi  input 2.0K'], 'primary');

    for (const width of [39, 24, 20, 10, 4, 1]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('rebuilds its body from the active palette on invalidate', () => {
    // Emit the resolved palette value as visible text so the assertion holds
    // regardless of chalk's colour level in the test environment.
    const component = new UsagePanelComponent(() => [`text=${currentTheme.color('text')}`], 'primary');
    const bodyOf = (): string => {
      const line = component.render(80).map(strip).find((l) => l.includes('text='));
      if (line === undefined) throw new Error('body line not found');
      return line;
    };

    expect(bodyOf()).toContain(darkColors.text);
    currentTheme.setPalette(lightColors);
    component.invalidate();
    expect(bodyOf()).toContain(lightColors.text);
  });
});
