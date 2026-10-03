import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolChainSummaryComponent } from '#/tui/components/messages/tool-chain-summary';
import { setActiveTranscriptDetail } from '#/tui/features/transcript/transcript-density';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('ToolChainSummaryComponent', () => {
  const prev = chalk.level;
  beforeEach(() => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
  });
  afterEach(() => {
    chalk.level = prev;
    setActiveTranscriptDetail('standard');
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('shows click-expand nudge at minimal density when tools recorded', () => {
    chalk.level = 3;
    setActiveTranscriptDetail('minimal');
    const chain = new ToolChainSummaryComponent(0);
    chain.record({});
    const plain = stripAnsi(chain.render(60).join('\n'));
    expect(plain).toMatch(/tools/);
    expect(plain).toMatch(/click expand/i);
  });

  it('omits click-expand nudge outside minimal', () => {
    chalk.level = 3;
    setActiveTranscriptDetail('compact');
    const chain = new ToolChainSummaryComponent(0);
    chain.record({});
    const plain = stripAnsi(chain.render(60).join('\n'));
    expect(plain).not.toMatch(/click expand/i);
  });

  it('compact paints dim metrics without a phase gutter', () => {
    chalk.level = 3;
    setActiveTranscriptDetail('compact');
    const chain = new ToolChainSummaryComponent(0);
    chain.record({ isError: true, errorText: 'command exited 1' });
    const plain = stripAnsi(chain.render(60).join('\n'));
    expect(plain).toContain('1 tool');
    expect(plain).toContain('1 failed');
    expect(plain).not.toContain('file');
    expect(plain).not.toMatch(/▌/);
    expect(plain).not.toMatch(/click expand/i);
  });
});
